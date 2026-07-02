import type { Money } from './money.js';

export interface Position {
  readonly symbol: string;
  readonly quantity: number;
  /** Average cost per share. */
  readonly avgCost: Money;
  /** Current market price per share. */
  readonly marketPrice: Money;
  /** Total unrealized P&L for the whole position. */
  readonly unrealizedPnl: Money;
}
