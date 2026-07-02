/**
 * ═══════════════════════════════ HUMAN-OWNED MODULE ═══════════════════════════════
 * Money math utilities — implemented by the human (CLAUDE.md learning protocol #3).
 * Claude scaffolds signatures and tests only; the bodies below are stubs.
 *
 * The spec lives in tests/unit/money-math.test.ts. Remove `.skip` there and
 * implement here until the suite is green.
 * ═══════════════════════════════════════════════════════════════════════════════════
 */
import type { CurrencyCode, Money } from './money.js';
import { NotImplementedError } from '../errors.js';

/**
 * Construct Money, validating that `amountCents` is a safe integer.
 * Throws InvalidMoneyError otherwise.
 */
export function money(_amountCents: number, _currency: CurrencyCode): Money {
  throw new NotImplementedError('money() is human-owned and not implemented yet');
}

/**
 * Sum two Money values of the same currency.
 * Throws CurrencyMismatchError if the currencies differ.
 */
export function addMoney(_a: Money, _b: Money): Money {
  throw new NotImplementedError('addMoney() is human-owned and not implemented yet');
}

/**
 * Render Money for display, e.g. { 123456, "USD" } → "$1,234.56".
 * With { withSign: true }, positive amounts get a leading "+" (zero gets none).
 * Hint: Intl.NumberFormat('en-US', { style: 'currency', currency }) does the
 * heavy lifting — but it expects major units, and division brings floats back.
 * Think about where the integer→display conversion is allowed to happen.
 */
export function formatMoney(_m: Money, _opts?: { withSign?: boolean }): string {
  throw new NotImplementedError('formatMoney() is human-owned and not implemented yet');
}

/**
 * Percent change from `from` to `to`, as a plain number (e.g. 8.5 for +8.5%).
 * This is display math, not money math — a float return is acceptable here.
 * Throws CurrencyMismatchError if currencies differ; InvalidMoneyError if
 * `from` is zero (undefined change).
 */
export function percentChange(_from: Money, _to: Money): number {
  throw new NotImplementedError('percentChange() is human-owned and not implemented yet');
}
