import { describe, expect, it } from 'vitest';
import { extractRecommendation } from '../../src/domain/services/recommendation-extractor.js';
import { RecommendationTracker } from '../../src/domain/services/recommendation-tracker.js';
import { StatusService } from '../../src/domain/services/status-service.js';
import { SystemState } from '../../src/domain/services/system-state.js';
import type { BrokerPort } from '../../src/domain/ports/broker-port.js';
import { FakeStorage } from '../helpers/fake-storage.js';
import { MutableClock } from '../helpers/mutable-clock.js';

const usd = (amountCents: number) => ({ amountCents, currency: 'USD' });
const DAY_MS = 24 * 60 * 60 * 1000;

const position = (symbol: string, priceCents: number) => ({
  symbol,
  quantity: 8,
  avgCost: usd(90_000),
  marketPrice: usd(priceCents),
  unrealizedPnl: usd(8 * (priceCents - 90_000)),
});

describe('extractRecommendation', () => {
  it('pulls out the structured line and removes it from the prose', () => {
    const result = extractRecommendation(
      'NVDA has run hard this month.\nREC: NVDA | trim | up 30% since entry',
    );

    expect(result.text).toBe('NVDA has run hard this month.');
    expect(result.recommendation).toEqual({
      symbol: 'NVDA',
      direction: 'trim',
      rationale: 'up 30% since entry',
    });
  });

  it('returns the message unchanged when there is no REC line', () => {
    const result = extractRecommendation('Nothing much happened today.');
    expect(result.text).toBe('Nothing much happened today.');
    expect(result.recommendation).toBeUndefined();
  });

  it('drops a REC line with an unknown direction rather than storing garbage', () => {
    const result = extractRecommendation('Text.\nREC: NVDA | yolo | to the moon');
    expect(result.text).toBe('Text.');
    expect(result.recommendation).toBeUndefined();
  });

  it('normalizes direction case', () => {
    const result = extractRecommendation('Text.\nREC: AAPL | BUY | cheap on earnings');
    expect(result.recommendation?.direction).toBe('buy');
  });
});

describe('RecommendationTracker', () => {
  it('records against the price at the time it was made', async () => {
    const storage = new FakeStorage();
    const tracker = new RecommendationTracker(storage);

    await tracker.record(
      { symbol: 'NVDA', direction: 'trim', rationale: 'run up' },
      [position('NVDA', 117_500)],
      new Date('2026-07-06T09:00:00.000Z'),
      'summary',
    );

    expect(storage.recommendations[0]).toMatchObject({
      symbol: 'NVDA',
      priceCents: 117_500,
      source: 'summary',
    });
  });

  it('ignores a recommendation about a symbol with no price to score against', async () => {
    const storage = new FakeStorage();
    const tracker = new RecommendationTracker(storage);

    await tracker.record(
      { symbol: 'TSLA', direction: 'buy', rationale: 'hunch' },
      [position('NVDA', 117_500)],
      new Date(),
      'chat',
    );

    expect(storage.recommendations).toEqual([]);
  });

  it('scores only what is old enough, using the current price', async () => {
    const storage = new FakeStorage();
    const tracker = new RecommendationTracker(storage);
    const madeAt = new Date('2026-07-06T09:00:00.000Z');

    await tracker.record(
      { symbol: 'NVDA', direction: 'trim', rationale: 'run up' },
      [position('NVDA', 100_000)],
      madeAt,
      'summary',
    );

    const broker = {
      getQuotes: async (symbols: string[]) =>
        symbols.map((symbol) => ({ symbol, price: usd(90_000), asOf: madeAt })),
    } as unknown as BrokerPort;

    const tooEarly = await tracker.scoreDue(broker, new Date(madeAt.getTime() + DAY_MS / 2));
    expect(tooEarly.scored).toBe(0);

    const result = await tracker.scoreDue(broker, new Date(madeAt.getTime() + 2 * DAY_MS));
    expect(result.scored).toBe(1);
    expect(storage.recommendations[0]?.scores).toEqual({ '1d': -10 });
  });
});

describe('StatusService', () => {
  it('reports paused state, broker health and stored counts', async () => {
    const clock = new MutableClock();
    const state = new SystemState(clock.now());
    const storage = new FakeStorage();
    const service = new StatusService(clock, state, 'Asia/Jerusalem', storage);

    clock.advance(90 * 60_000);
    state.recordPoll(clock.now(), { ok: true, detail: 'paper broker' });
    state.setPaused(true);

    const status = await service.renderStatus();

    expect(status).toContain('PAUSED');
    expect(status).toContain('Uptime: 1h 30m');
    expect(status).toContain('Broker: connected');
    expect(status).toContain('Last summary: never');
  });

  it('reports hit rate per horizon and excludes directionless suggestions', async () => {
    const clock = new MutableClock();
    const storage = new FakeStorage();
    const service = new StatusService(clock, new SystemState(clock.now()), 'UTC', storage);

    const id = await storage.saveRecommendation({
      madeAt: clock.now(),
      symbol: 'NVDA',
      direction: 'trim',
      rationale: 'run up',
      priceCents: 100_000,
      currency: 'USD',
      source: 'summary',
    });
    await storage.recordRecommendationScore(id, '1d', -4);
    const holdId = await storage.saveRecommendation({
      madeAt: clock.now(),
      symbol: 'AAPL',
      direction: 'hold',
      rationale: 'no change',
      priceCents: 20_000,
      currency: 'USD',
      source: 'summary',
    });
    await storage.recordRecommendationScore(holdId, '1d', 12);

    const stats = await service.renderStats();

    // The 'trim' call was right (price fell); the 'hold' is not counted at all.
    expect(stats).toContain('1d: 1/1 went the suggested way (100%)');
    expect(stats).toContain('average move -4.0%');
    expect(stats).toContain('7d: not scored yet');
  });
});
