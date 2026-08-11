import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WATCHDOG_CONFIG,
  evaluateRules,
  type PricePoint,
  type WatchdogConfig,
  type WatchdogInput,
} from '../../src/domain/services/watchdog-rules.js';

const usd = (amountCents: number) => ({ amountCents, currency: 'USD' });
const NOW = new Date('2026-07-06T14:00:00.000Z');

/** Prices at N minutes before NOW, oldest first. */
function history(points: readonly [minutesAgo: number, priceCents: number][]): PricePoint[] {
  return points
    .map(([minutesAgo, priceCents]) => ({
      at: new Date(NOW.getTime() - minutesAgo * 60_000),
      priceCents,
    }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

function input(overrides: Partial<WatchdogInput> = {}): WatchdogInput {
  return {
    now: NOW,
    quotes: [{ symbol: 'NVDA', price: usd(100_000), asOf: NOW }],
    account: { equity: usd(10_000_000), cash: usd(1_000_000), dayPnl: usd(0) },
    history: new Map([['NVDA', history([[20, 100_000], [0, 100_000]])]]),
    config: DEFAULT_WATCHDOG_CONFIG,
    ...overrides,
  };
}

describe('position_drop', () => {
  it('does not fire on a flat price', () => {
    expect(evaluateRules(input())).toEqual([]);
  });

  it('fires when the price is down more than the first tier from the window peak', () => {
    const triggers = evaluateRules(
      input({
        quotes: [{ symbol: 'NVDA', price: usd(95_000), asOf: NOW }],
        history: new Map([['NVDA', history([[20, 100_000], [0, 95_000]])]]),
      }),
    );

    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.ruleId).toBe('position_drop');
    expect(triggers[0]?.subject).toBe('NVDA');
    expect(triggers[0]?.changePercent).toBeCloseTo(-5);
    expect(triggers[0]?.tierPercent).toBe(4);
    expect(triggers[0]?.referencePriceCents).toBe(100_000);
  });

  it('reports the highest tier the move clears', () => {
    const triggers = evaluateRules(
      input({
        quotes: [{ symbol: 'NVDA', price: usd(89_000), asOf: NOW }],
        history: new Map([['NVDA', history([[20, 100_000], [0, 89_000]])]]),
      }),
    );
    expect(triggers[0]?.tierPercent).toBe(10);
  });

  it('measures from the window peak, so a round trip up and back counts as a drop', () => {
    const triggers = evaluateRules(
      input({
        quotes: [{ symbol: 'NVDA', price: usd(100_000), asOf: NOW }],
        history: new Map([
          ['NVDA', history([[25, 100_000], [10, 110_000], [0, 100_000]])],
        ]),
      }),
    );
    expect(triggers[0]?.changePercent).toBeCloseTo(-9.09, 1);
    expect(triggers[0]?.tierPercent).toBe(7);
  });

  it('ignores prices that fell out of the rolling window', () => {
    const triggers = evaluateRules(
      input({
        quotes: [{ symbol: 'NVDA', price: usd(95_000), asOf: NOW }],
        // the 100,000 peak is 45 minutes old — older than the 30-minute window
        history: new Map([
          ['NVDA', history([[45, 100_000], [20, 95_100], [0, 95_000]])],
        ]),
      }),
    );
    expect(triggers).toEqual([]);
  });

  it('stays silent until there are at least two points in the window', () => {
    const triggers = evaluateRules(
      input({
        quotes: [{ symbol: 'NVDA', price: usd(50_000), asOf: NOW }],
        history: new Map([['NVDA', history([[0, 50_000]])]]),
      }),
    );
    expect(triggers).toEqual([]);
  });
});

describe('portfolio_drop', () => {
  it('fires on the day P&L implied percentage, not on a stored opening equity', () => {
    const triggers = evaluateRules(
      input({
        account: { equity: usd(9_700_000), cash: usd(1_000_000), dayPnl: usd(-300_000) },
      }),
    );

    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.ruleId).toBe('portfolio_drop');
    expect(triggers[0]?.subject).toBe('PORTFOLIO');
    // -300,000 against an opening equity of 10,000,000 = -3%
    expect(triggers[0]?.changePercent).toBeCloseTo(-3);
    expect(triggers[0]?.tierPercent).toBe(2);
  });

  it('does not fire on a gain of the same size', () => {
    const triggers = evaluateRules(
      input({
        account: { equity: usd(10_300_000), cash: usd(1_000_000), dayPnl: usd(300_000) },
      }),
    );
    expect(triggers).toEqual([]);
  });
});

describe('level_cross', () => {
  const withLevel = (config: Partial<WatchdogConfig>) => ({
    ...DEFAULT_WATCHDOG_CONFIG,
    ...config,
  });

  it('fires on the poll where the price crosses below the level', () => {
    const triggers = evaluateRules(
      input({
        quotes: [{ symbol: 'NVDA', price: usd(99_900), asOf: NOW }],
        history: new Map([['NVDA', history([[5, 100_100], [0, 99_900]])]]),
        config: withLevel({
          positionDropTiers: [],
          levels: [{ symbol: 'NVDA', priceCents: 100_000, direction: 'below' }],
        }),
      }),
    );

    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.ruleId).toBe('level_cross');
  });

  it('does not re-fire while the price stays past the level', () => {
    const triggers = evaluateRules(
      input({
        quotes: [{ symbol: 'NVDA', price: usd(99_800), asOf: NOW }],
        history: new Map([['NVDA', history([[5, 99_900], [0, 99_800]])]]),
        config: withLevel({
          positionDropTiers: [],
          levels: [{ symbol: 'NVDA', priceCents: 100_000, direction: 'below' }],
        }),
      }),
    );
    expect(triggers).toEqual([]);
  });

  it('fires on an upward cross for an above-level watch', () => {
    const triggers = evaluateRules(
      input({
        quotes: [{ symbol: 'NVDA', price: usd(100_100), asOf: NOW }],
        history: new Map([['NVDA', history([[5, 99_900], [0, 100_100]])]]),
        config: withLevel({
          levels: [{ symbol: 'NVDA', priceCents: 100_000, direction: 'above' }],
        }),
      }),
    );
    expect(triggers.map((t) => t.ruleId)).toEqual(['level_cross']);
  });
});
