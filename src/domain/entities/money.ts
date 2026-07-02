/** ISO 4217 currency code, e.g. "USD". */
export type CurrencyCode = string;

/**
 * Money is always integer minor units (cents) + a currency code — never a float.
 * Floats come from the outside world (broker SDKs, APIs); adapters must convert
 * to integer cents at the boundary, before values enter the domain.
 */
export interface Money {
  readonly amountCents: number;
  readonly currency: CurrencyCode;
}
