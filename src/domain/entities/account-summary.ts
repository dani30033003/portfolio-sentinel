import type { Money } from './money.js';

export interface AccountSummary {
  readonly equity: Money;
  readonly cash: Money;
  readonly dayPnl: Money;
}
