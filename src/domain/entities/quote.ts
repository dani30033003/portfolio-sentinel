import type { Money } from './money.js';

export interface Quote {
  readonly symbol: string;
  readonly price: Money;
  /** When the price was observed (UTC, like all stored timestamps). */
  readonly asOf: Date;
}
