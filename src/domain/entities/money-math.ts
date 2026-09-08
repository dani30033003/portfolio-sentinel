/**
 * Money math. Amounts are integer cents paired with an ISO currency code, never
 * floats — 0.1 + 0.2 is not 0.3 in binary floating point, and a portfolio that
 * accumulates that error reports numbers that do not reconcile.
 *
 * The executable spec for this module is tests/unit/money-math.test.ts.
 */
import type { CurrencyCode, Money } from './money.js';
import { CurrencyMismatchError, InvalidMoneyError} from '../errors.js';

/**
 * Construct Money, validating that `amountCents` is a safe integer.
 * Throws InvalidMoneyError otherwise.
 */
export function money(amountCents: number, currency: CurrencyCode): Money {
  if (!Number.isSafeInteger(amountCents)) {
    throw new InvalidMoneyError('Amount must be a safe integer');
  }
  return { amountCents, currency };
}

/**
 * Sum two Money values of the same currency.
 * Throws CurrencyMismatchError if the currencies differ.
 */
export function addMoney(a: Money, b: Money): Money {
    if (a.currency !== b.currency) {
        throw new CurrencyMismatchError(`Cannot add ${a.currency} to ${b.currency}`);
    }
    return { amountCents: a.amountCents + b.amountCents, currency: a.currency };
}

/**
 * Render Money for display, e.g. { 123456, "USD" } → "$1,234.56".
 * With { withSign: true }, positive amounts get a leading "+" (zero gets none).
 *
 * The division by 100 is the one place floats are allowed: it happens at the
 * display boundary, on a value that is never read back into a calculation.
 */
export function formatMoney(m: Money, opts?: { withSign?: boolean }): string {
  const formatted = Intl.NumberFormat('en-US', { style: 'currency', currency: m.currency }).format(m.amountCents / 100);
  if (opts?.withSign && m.amountCents > 0) {
    return `+${formatted}`;
  }
  return formatted;
}

/**
 * Percent change from `from` to `to`, as a plain number (e.g. 8.5 for +8.5%).
 * This is display math, not money math — a float return is acceptable here.
 * Throws CurrencyMismatchError if currencies differ; InvalidMoneyError if
 * `from` is zero (undefined change).
 */
export function percentChange(from: Money, to: Money): number {
  if (from.currency !== to.currency) {
    throw new CurrencyMismatchError(`Cannot calculate percent change from ${from.currency} to ${to.currency}`);
  }
  if (from.amountCents === 0) {
    throw new InvalidMoneyError(`Cannot calculate percent change from ${from.currency} to ${to.currency}`);
  }
  const change = (to.amountCents - from.amountCents) / from.amountCents;
  return change * 100;
}
