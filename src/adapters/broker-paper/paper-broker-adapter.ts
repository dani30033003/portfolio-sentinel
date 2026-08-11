import type { BrokerPort } from '../../domain/ports/broker-port.js';
import type { ClockPort } from '../../domain/ports/clock-port.js';
import type { AccountSummary } from '../../domain/entities/account-summary.js';
import type { HealthStatus } from '../../domain/entities/health.js';
import type { Position } from '../../domain/entities/position.js';
import type { Quote } from '../../domain/entities/quote.js';
import { SystemClock } from '../clock-system/system-clock.js';
import { MarketSimulator, type SimulatorConfig } from './market-simulator.js';

const usd = (amountCents: number) => ({ amountCents, currency: 'USD' });

/** What the account owns. Prices are not part of it — the simulator owns those. */
export interface Holding {
  readonly symbol: string;
  readonly quantity: number;
  /** Average cost per share, integer cents. */
  readonly avgCostCents: number;
  /** Price the simulated session opens at, integer cents. */
  readonly openPriceCents: number;
}

export interface PaperBrokerOptions {
  readonly holdings?: readonly Holding[];
  /** Uninvested cash, integer cents. Constant — this adapter never trades. */
  readonly cashCents?: number;
  readonly clock?: ClockPort;
  readonly simulator?: Partial<SimulatorConfig>;
}

/**
 * Simulated broker. Three jobs: the walking-skeleton data source, the
 * permanent test double that must pass the same contract suite as a real
 * IBKRAdapter, and — since prices come from MarketSimulator rather than a
 * frozen fixture — the thing that lets the watchdog be exercised without a
 * broker connection at all.
 *
 * Derived values (unrealizedPnl, equity, dayPnl) are computed here from live
 * prices rather than stored, so they cannot drift out of agreement with the
 * price the same call reports. The contract suite asserts exactly that.
 */
export class PaperBrokerAdapter implements BrokerPort {
  private readonly holdings: readonly Holding[];
  private readonly cashCents: number;
  readonly simulator: MarketSimulator;

  constructor(options: PaperBrokerOptions = {}) {
    this.holdings = options.holdings ?? DEFAULT_HOLDINGS;
    this.cashCents = options.cashCents ?? DEFAULT_CASH_CENTS;
    this.simulator = new MarketSimulator(
      new Map(this.holdings.map((h) => [h.symbol, h.openPriceCents])),
      options.clock ?? new SystemClock(),
      options.simulator ?? {},
    );
  }

  async getAccountSummary(): Promise<AccountSummary> {
    const prices = this.simulator.currentPrices();
    let marketValue = 0;
    let dayPnl = 0;
    for (const holding of this.holdings) {
      const price = prices.get(holding.symbol) ?? 0;
      marketValue += holding.quantity * price;
      dayPnl += holding.quantity * (price - this.simulator.openPriceOf(holding.symbol));
    }
    return {
      equity: usd(Math.round(this.cashCents + marketValue)),
      cash: usd(this.cashCents),
      dayPnl: usd(Math.round(dayPnl)),
    };
  }

  async getPositions(): Promise<Position[]> {
    const prices = this.simulator.currentPrices();
    return this.holdings.map((holding) => {
      const price = prices.get(holding.symbol) ?? 0;
      return {
        symbol: holding.symbol,
        quantity: holding.quantity,
        avgCost: usd(holding.avgCostCents),
        marketPrice: usd(price),
        unrealizedPnl: usd(Math.round(holding.quantity * (price - holding.avgCostCents))),
      };
    });
  }

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const prices = this.simulator.currentPrices();
    const asOf = new Date();
    return this.holdings
      .filter((h) => symbols.includes(h.symbol))
      .map((h) => ({ symbol: h.symbol, price: usd(prices.get(h.symbol) ?? 0), asOf }));
  }

  async healthCheck(): Promise<HealthStatus> {
    return { ok: true, detail: 'paper broker (simulated)' };
  }
}

const DEFAULT_HOLDINGS: readonly Holding[] = [
  { symbol: 'AAPL', quantity: 10, avgCostCents: 15_000, openPriceCents: 19_530 },
  { symbol: 'MSFT', quantity: 5, avgCostCents: 40_000, openPriceCents: 38_000 },
  { symbol: 'VOO', quantity: 12, avgCostCents: 45_000, openPriceCents: 51_200 },
  { symbol: 'NVDA', quantity: 8, avgCostCents: 90_000, openPriceCents: 117_500 },
];

const DEFAULT_CASH_CENTS = 1_240_000;
