import { describe, expect, it } from 'vitest';
import { WatchdogService } from '../../src/domain/services/watchdog-service.js';
import { SystemState } from '../../src/domain/services/system-state.js';
import { DEFAULT_WATCHDOG_CONFIG } from '../../src/domain/services/watchdog-rules.js';
import type { BrokerPort } from '../../src/domain/ports/broker-port.js';
import type { LLMPort } from '../../src/domain/ports/llm-port.js';
import type { MessagingPort } from '../../src/domain/ports/messaging-port.js';
import { LlmError, MessageSendError } from '../../src/domain/errors.js';
import { MutableClock } from '../helpers/mutable-clock.js';
import { FakeStorage } from '../helpers/fake-storage.js';

const usd = (amountCents: number) => ({ amountCents, currency: 'USD' });
const CASH_CENTS = 10_000_000;

/**
 * A broker whose single position's price the test moves by hand. Cash is large
 * relative to the position on purpose: it keeps a symbol-sized drop well under
 * the portfolio tiers, so these tests exercise position_drop alone. (Both rules
 * firing on one move is correct behaviour — watchdog-rules.test.ts covers it.)
 */
class ScriptedBroker implements BrokerPort {
  priceCents = 100_000;
  healthy = true;

  constructor(private readonly clock: MutableClock) {}

  async getAccountSummary() {
    const equity = CASH_CENTS + 8 * this.priceCents;
    return {
      equity: usd(equity),
      cash: usd(CASH_CENTS),
      dayPnl: usd(8 * (this.priceCents - 100_000)),
    };
  }

  async getPositions() {
    return [
      {
        symbol: 'NVDA',
        quantity: 8,
        avgCost: usd(90_000),
        marketPrice: usd(this.priceCents),
        unrealizedPnl: usd(8 * (this.priceCents - 90_000)),
      },
    ];
  }

  async getQuotes(symbols: string[]) {
    return symbols.map((symbol) => ({
      symbol,
      price: usd(this.priceCents),
      asOf: this.clock.now(),
    }));
  }

  async healthCheck() {
    return this.healthy
      ? { ok: true, detail: 'scripted broker' }
      : { ok: false, detail: 'gateway unreachable' };
  }
}

class RecordingMessaging implements MessagingPort {
  readonly sent: string[] = [];
  async sendMessage(_to: string, text: string): Promise<void> {
    this.sent.push(text);
  }
}

function makeWatchdog(
  options: { llm?: LLMPort; storage?: FakeStorage; dailyCap?: number } = {},
) {
  const clock = new MutableClock();
  const broker = new ScriptedBroker(clock);
  const messaging = new RecordingMessaging();
  const state = new SystemState(clock.now());
  const watchdog = new WatchdogService(
    broker,
    clock,
    messaging,
    'console',
    state,
    {
      timeZone: 'Asia/Jerusalem',
      rules: { ...DEFAULT_WATCHDOG_CONFIG, positionDropTiers: [4, 7, 10] },
      policy: { cooldownMs: 2 * 60 * 60 * 1000, dailyCap: options.dailyCap ?? 10 },
    },
    options.llm ? { llm: options.llm, timeoutMs: 50 } : undefined,
    options.storage,
  );
  return { watchdog, broker, messaging, clock, state };
}

/** Poll once at the current price, then again after a drop of `percent`. */
async function pollThenDrop(
  context: ReturnType<typeof makeWatchdog>,
  percent: number,
): Promise<void> {
  await context.watchdog.poll();
  context.clock.advance(60_000);
  context.broker.priceCents = Math.round(context.broker.priceCents * (1 - percent / 100));
  await context.watchdog.poll();
}

describe('WatchdogService.poll', () => {
  it('sends nothing while prices are flat', async () => {
    const context = makeWatchdog();
    await pollThenDrop(context, 0);
    expect(context.messaging.sent).toEqual([]);
  });

  it('sends a numeric alert when a rule fires and no LLM is configured', async () => {
    const context = makeWatchdog();
    await pollThenDrop(context, 5);

    expect(context.messaging.sent).toHaveLength(1);
    expect(context.messaging.sent[0]).toContain('ALERT NVDA');
    expect(context.messaging.sent[0]).toContain('-5.0%');
    expect(context.messaging.sent[0]).toContain('8 shares');
  });

  it('falls back to the numeric alert when the LLM fails', async () => {
    const failing: LLMPort = { complete: () => Promise.reject(new LlmError('503')) };
    const context = makeWatchdog({ llm: failing });
    await pollThenDrop(context, 5);

    expect(context.messaging.sent[0]).toContain('ALERT NVDA');
  });

  it('falls back to the numeric alert when the LLM hangs past its timeout', async () => {
    const hanging: LLMPort = { complete: () => new Promise<string>(() => undefined) };
    const context = makeWatchdog({ llm: hanging });
    await pollThenDrop(context, 5);

    expect(context.messaging.sent[0]).toContain('ALERT NVDA');
  });

  it('uses the LLM text when the call succeeds', async () => {
    const llm: LLMPort = { complete: async () => 'NVDA slid 5% in half an hour.' };
    const context = makeWatchdog({ llm });
    await pollThenDrop(context, 5);

    expect(context.messaging.sent[0]).toBe('NVDA slid 5% in half an hour.');
  });

  it('records sent alerts to storage and honours the daily cap across polls', async () => {
    const storage = new FakeStorage();
    const context = makeWatchdog({ storage, dailyCap: 1 });

    await pollThenDrop(context, 5);
    expect(storage.alerts).toHaveLength(1);

    // A worse move would normally break the cooldown by tier — the cap outranks it.
    context.clock.advance(60_000);
    context.broker.priceCents = 80_000;
    const result = await context.watchdog.poll();

    expect(context.messaging.sent).toHaveLength(1);
    expect(result.suppressed.map((s) => s.reason)).toContain('daily_cap');
  });

  it('stays silent while paused', async () => {
    const context = makeWatchdog();
    context.state.setPaused(true);
    const [, result] = [await context.watchdog.poll(), await dropAndPoll(context, 6)];

    expect(context.messaging.sent).toEqual([]);
    expect(result.suppressed.map((s) => s.reason)).toEqual(['paused']);
  });

  it('reports a persistently unhealthy broker once, then reports recovery', async () => {
    const context = makeWatchdog();
    context.broker.healthy = false;

    await context.watchdog.poll();
    expect(context.messaging.sent).toEqual([]); // one bad poll is not news

    context.clock.advance(11 * 60_000);
    await context.watchdog.poll();
    await context.watchdog.poll();
    expect(context.messaging.sent).toHaveLength(1);
    expect(context.messaging.sent[0]).toContain('I am blind');

    context.broker.healthy = true;
    await context.watchdog.poll();
    expect(context.messaging.sent[1]).toContain('back');
  });

  it('collects a send failure instead of throwing out of the poll loop', async () => {
    const context = makeWatchdog();
    context.messaging.sendMessage = () => Promise.reject(new MessageSendError('network down'));

    await context.watchdog.poll();
    context.clock.advance(60_000);
    context.broker.priceCents = 95_000;
    const result = await context.watchdog.poll();

    expect(result.errors).toEqual(['network down']);
    expect(result.sent).toEqual([]);
  });
});

async function dropAndPoll(context: ReturnType<typeof makeWatchdog>, percent: number) {
  context.clock.advance(60_000);
  context.broker.priceCents = Math.round(context.broker.priceCents * (1 - percent / 100));
  return context.watchdog.poll();
}
