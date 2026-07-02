/**
 * NOTE: skipped until money-math.ts (human-owned) is implemented — SummaryService
 * formats every figure through those utilities. Unskip together with
 * tests/unit/money-math.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { SummaryService } from '../../src/domain/services/summary-service.js';
import type { BrokerPort } from '../../src/domain/ports/broker-port.js';
import type { ClockPort } from '../../src/domain/ports/clock-port.js';

const usd = (amountCents: number) => ({ amountCents, currency: 'USD' });

const stubBroker: BrokerPort = {
  getAccountSummary: async () => ({
    equity: usd(10523010),
    cash: usd(1240000),
    dayPnl: usd(120344),
  }),
  getPositions: async () => [
    {
      symbol: 'AAPL',
      quantity: 10,
      avgCost: usd(15000),
      marketPrice: usd(19530),
      unrealizedPnl: usd(45300),
    },
    {
      symbol: 'MSFT',
      quantity: 5,
      avgCost: usd(40000),
      marketPrice: usd(38000),
      unrealizedPnl: usd(-10000),
    },
  ],
  getQuotes: async () => [],
  healthCheck: async () => ({ ok: true, detail: 'stub' }),
};

// 12:05 UTC = 15:05 in Asia/Jerusalem (UTC+3 in July / DST)
const fixedClock: ClockPort = { now: () => new Date('2026-07-02T12:05:00Z') };

describe.skip('SummaryService.buildSnapshotSummary', () => {
  const service = new SummaryService(stubBroker, fixedClock, 'Asia/Jerusalem');

  it('renders the account line with formatted money', async () => {
    const text = await service.buildSnapshotSummary();
    expect(text).toContain('Equity $105,230.10');
    expect(text).toContain('Cash $12,400.00');
    expect(text).toContain('Day P&L +$1,203.44');
  });

  it('renders one line per position with percent change and signed P&L', async () => {
    const text = await service.buildSnapshotSummary();
    expect(text).toContain('AAPL: 10 @ $150.00 → $195.30 (+30.2%) P&L +$453.00');
    expect(text).toContain('MSFT: 5 @ $400.00 → $380.00 (-5.0%) P&L -$100.00');
  });

  it('formats the timestamp in the configured timezone, not UTC', async () => {
    const text = await service.buildSnapshotSummary();
    expect(text).toContain('2 Jul 2026');
    expect(text).toContain('15:05'); // 12:05 UTC shown as Jerusalem local time
  });
});
