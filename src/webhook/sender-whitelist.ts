/**
 * Checks whether a WhatsApp sender is on the configured allowlist. Pure and
 * synchronous — no mocking needed to test, same shape as verifySignature.
 */
export function isWhitelistedSender(phoneNumber: string, whitelist: readonly string[]): boolean {
  return whitelist.includes(phoneNumber);
}
