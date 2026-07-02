/**
 * ═══════════════════════════════ HUMAN-OWNED MODULE ═══════════════════════════════
 * This suite is the executable spec for src/domain/entities/money-math.ts.
 *
 * Your task: change each `describe.skip` below to `describe`, run `npm test`,
 * and implement money-math.ts until everything is green. Do the same for
 * tests/unit/summary-service.test.ts, which depends on these utilities.
 * ═══════════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import { addMoney, formatMoney, money, percentChange } from '../../src/domain/entities/money-math.js';
import { CurrencyMismatchError, InvalidMoneyError } from '../../src/domain/errors.js';

describe('money()', () => {
  it('constructs integer-cent money', () => {
    expect(money(123456, 'USD')).toEqual({ amountCents: 123456, currency: 'USD' });
  });

  it('accepts zero and negative amounts', () => {
    expect(money(0, 'USD').amountCents).toBe(0);
    expect(money(-500, 'USD').amountCents).toBe(-500);
  });

  it('rejects non-integer amounts', () => {
    expect(() => money(10.5, 'USD')).toThrow(InvalidMoneyError);
  });

  it('rejects NaN and infinities', () => {
    expect(() => money(Number.NaN, 'USD')).toThrow(InvalidMoneyError);
    expect(() => money(Number.POSITIVE_INFINITY, 'USD')).toThrow(InvalidMoneyError);
  });

  it('rejects amounts beyond safe-integer range', () => {
    expect(() => money(Number.MAX_SAFE_INTEGER + 1, 'USD')).toThrow(InvalidMoneyError);
  });
});

describe('addMoney()', () => {
  it('adds same-currency amounts', () => {
    expect(addMoney(money(150, 'USD'), money(250, 'USD'))).toEqual(money(400, 'USD'));
  });

  it('handles negative amounts', () => {
    expect(addMoney(money(1000, 'USD'), money(-300, 'USD'))).toEqual(money(700, 'USD'));
  });

  it('throws on currency mismatch', () => {
    expect(() => addMoney(money(100, 'USD'), money(100, 'EUR'))).toThrow(CurrencyMismatchError);
  });
});

describe('formatMoney()', () => {
  // Contract: en-US currency formatting of the major units, e.g. "$1,234.56".
  it('formats USD with grouping and two decimals', () => {
    expect(formatMoney(money(123456, 'USD'))).toBe('$1,234.56');
  });

  it('formats sub-dollar amounts', () => {
    expect(formatMoney(money(5, 'USD'))).toBe('$0.05');
  });

  it('formats negative amounts', () => {
    expect(formatMoney(money(-1234, 'USD'))).toBe('-$12.34');
  });

  it('adds a leading + for positive amounts when withSign is set', () => {
    expect(formatMoney(money(1234, 'USD'), { withSign: true })).toBe('+$12.34');
  });

  it('does not sign zero even when withSign is set', () => {
    expect(formatMoney(money(0, 'USD'), { withSign: true })).toBe('$0.00');
  });

  it('respects the currency code', () => {
    expect(formatMoney(money(123456, 'EUR'))).toBe('€1,234.56');
  });
});

describe('percentChange()', () => {
  it('computes positive change', () => {
    expect(percentChange(money(10000, 'USD'), money(10850, 'USD'))).toBeCloseTo(8.5);
  });

  it('computes negative change', () => {
    expect(percentChange(money(20000, 'USD'), money(19000, 'USD'))).toBeCloseTo(-5);
  });

  it('returns zero for no change', () => {
    expect(percentChange(money(5000, 'USD'), money(5000, 'USD'))).toBe(0);
  });

  it('throws on currency mismatch', () => {
    expect(() => percentChange(money(100, 'USD'), money(100, 'EUR'))).toThrow(
      CurrencyMismatchError,
    );
  });

  it('throws when the base is zero (undefined change)', () => {
    expect(() => percentChange(money(0, 'USD'), money(100, 'USD'))).toThrow(InvalidMoneyError);
  });
});
