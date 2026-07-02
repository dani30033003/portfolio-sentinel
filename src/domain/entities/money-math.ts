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
 * Hint: Intl.NumberFormat('en-US', { style: 'currency', currency }) does the
 * heavy lifting — but it expects major units, and division brings floats back.
 * Think about where the integer→display conversion is allowed to happen.
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
