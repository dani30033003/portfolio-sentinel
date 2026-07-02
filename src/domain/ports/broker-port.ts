import type { AccountSummary } from '../entities/account-summary.js';
import type { HealthStatus } from '../entities/health.js';
import type { Position } from '../entities/position.js';
import type { Quote } from '../entities/quote.js';

/**
 * All broker access goes through this port. Two adapters implement it:
 * PaperBrokerAdapter (Phase 0) and IBKRAdapter (Phase 1) — both must pass
 * the shared contract suite in tests/contract/.
 *
 * placeOrder / getOrderStatus are deliberately absent until Phase 4.
 */
export interface BrokerPort {
  getAccountSummary(): Promise<AccountSummary>;
  getPositions(): Promise<Position[]>;
  getQuotes(symbols: string[]): Promise<Quote[]>;
  /** Is the broker session alive? Never throws — reports via HealthStatus. */
  healthCheck(): Promise<HealthStatus>;
}
