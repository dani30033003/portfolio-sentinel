import { describe, expect, it } from 'vitest';
import { MarketSimulator } from '../../src/adapters/broker-paper/market-simulator.js';
import { PaperBrokerAdapter } from '../../src/adapters/broker-paper/paper-broker-adapter.js';
import { MutableClock } from '../helpers/mutable-clock.js';

const initial = new Map([
  ['AAPL', 19_530],
  ['NVDA', 117_500],
]);

function makeSimulator(seed = 42): { sim: MarketSimulator; clock: MutableClock } {
  const clock = new MutableClock();
  const sim = new MarketSimulator(initial, clock, { seed, tickMs: 1_000, volatility: 0.01 });
  return { sim, clock };
}

describe('MarketSimulator', () => {
  it('produces the same price path for the same seed and elapsed time', () => {
    const a = makeSimulator();
    const b = makeSimulator();
    a.clock.advance(60_000);
    b.clock.advance(60_000);
    expect(a.sim.priceOf('AAPL')).toBe(b.sim.priceOf('AAPL'));
    expect(a.sim.priceOf('NVDA')).toBe(b.sim.priceOf('NVDA'));
  });

  it('produces a different path for a different seed', () => {
    const a = makeSimulator(1);
    const b = makeSimulator(2);
    a.clock.advance(60_000);
    b.clock.advance(60_000);
    expect(a.sim.priceOf('AAPL')).not.toBe(b.sim.priceOf('AAPL'));
  });

  it('does not move within a single tick, and moves once a tick elapses', () => {
    const { sim, clock } = makeSimulator();
    const start = sim.priceOf('AAPL');
    clock.advance(999);
    expect(sim.priceOf('AAPL')).toBe(start);
    clock.advance(1);
    expect(sim.priceOf('AAPL')).not.toBe(start);
  });

  it('keeps prices as positive integer cents across a long run', () => {
    const { sim, clock } = makeSimulator();
    clock.advance(4 * 60 * 60 * 1000);
    for (const symbol of sim.symbols()) {
      const price = sim.priceOf(symbol);
      expect(Number.isSafeInteger(price)).toBe(true);
      expect(price).toBeGreaterThan(0);
    }
  });

  it('applies a shock immediately and keeps the open price fixed', () => {
    const { sim } = makeSimulator();
    const before = sim.priceOf('NVDA');
    sim.shock('NVDA', -0.1);
    expect(sim.priceOf('NVDA')).toBe(Math.round(before * 0.9));
    expect(sim.openPriceOf('NVDA')).toBe(117_500);
  });
});

describe('PaperBrokerAdapter with simulated prices', () => {
  it('derives day P&L from the move away from open prices', async () => {
    const clock = new MutableClock();
    const broker = new PaperBrokerAdapter({
      holdings: [{ symbol: 'AAPL', quantity: 10, avgCostCents: 15_000, openPriceCents: 20_000 }],
      cashCents: 100_000,
      clock,
      simulator: { seed: 7, tickMs: 1_000, volatility: 0 },
    });

    const flat = await broker.getAccountSummary();
    expect(flat.dayPnl.amountCents).toBe(0);
    expect(flat.equity.amountCents).toBe(100_000 + 10 * 20_000);

    broker.simulator.shock('AAPL', -0.05);
    const dropped = await broker.getAccountSummary();
    expect(dropped.dayPnl.amountCents).toBe(10 * (19_000 - 20_000));
  });

  it('reports positions and quotes at the same price within one call', async () => {
    const broker = new PaperBrokerAdapter({ simulator: { seed: 3 } });
    const positions = await broker.getPositions();
    const quotes = await broker.getQuotes(positions.map((p) => p.symbol));
    for (const position of positions) {
      const quote = quotes.find((q) => q.symbol === position.symbol);
      expect(quote?.price.amountCents).toBe(position.marketPrice.amountCents);
    }
  });
});
