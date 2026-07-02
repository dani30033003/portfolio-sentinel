import type { BrokerPort } from '../../domain/ports/broker-port.js';
import type { AccountSummary } from '../../domain/entities/account-summary.js';
import type { HealthStatus } from '../../domain/entities/health.js';
import type { Position } from '../../domain/entities/position.js';
import type { Quote } from '../../domain/entities/quote.js';

const usd = (amountCents: number) => ({ amountCents, currency: 'USD' });

/**
 * Simulated broker with a fixture portfolio. Serves two jobs:
 * the Phase 0 walking-skeleton data source, and the permanent test double
 * that must pass the same contract suite as IBKRAdapter (Phase 1).
 *
 * Fixture invariant (checked by the contract suite):
 * unrealizedPnl === quantity × (marketPrice − avgCost).
 */
export class PaperBrokerAdapter implements BrokerPort {
  private readonly positions: Position[];
  private readonly account: AccountSummary;

  constructor(fixture?: { positions: Position[]; account: AccountSummary }) {
    this.positions = fixture?.positions ?? DEFAULT_POSITIONS;
    this.account = fixture?.account ?? DEFAULT_ACCOUNT;
  }

  async getAccountSummary(): Promise<AccountSummary> {
    return this.account;
  }

  async getPositions(): Promise<Position[]> {
    return this.positions;
  }

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const asOf = new Date();
    return this.positions
      .filter((p) => symbols.includes(p.symbol))
      .map((p) => ({ symbol: p.symbol, price: p.marketPrice, asOf }));
  }

  async healthCheck(): Promise<HealthStatus> {
    return { ok: true, detail: 'paper broker (simulated)' };
  }
}

const DEFAULT_POSITIONS: Position[] = [
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
  {
    symbol: 'VOO',
    quantity: 12,
    avgCost: usd(45000),
    marketPrice: usd(51200),
    unrealizedPnl: usd(74400),
  },
  {
    symbol: 'NVDA',
    quantity: 8,
    avgCost: usd(90000),
    marketPrice: usd(117500),
    unrealizedPnl: usd(220000),
  },
];

// equity = cash (12,400.00) + sum of position market values (19,397.00)
const DEFAULT_ACCOUNT: AccountSummary = {
  equity: usd(3179700),
  cash: usd(1240000),
  dayPnl: usd(-35200),
};
