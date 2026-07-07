import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Checks Meta's X-Hub-Signature-256 header: HMAC-SHA256 over the raw request
 * bytes, keyed with the app secret, hex-encoded, prefixed "sha256=".
 *
 * Must be computed over the bytes exactly as they arrived — never over
 * re-serialized JSON, which can differ in key order/whitespace and break the
 * digest. Pure function: no I/O, no clock, trivially unit-testable.
 */
export function verifySignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (signatureHeader === undefined || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  // Buffer.from(_, 'hex') stops at the first non-hex character, so malformed
  // input yields a short buffer and fails the length check below.
  const received = Buffer.from(signatureHeader.slice('sha256='.length), 'hex');

  // timingSafeEqual throws on unequal lengths rather than returning false.
  // Checking length first is safe: the correct length (32 bytes) is public
  // knowledge, so revealing "wrong length" leaks nothing an attacker lacks.
  if (received.length !== expected.length) {
    return false;
  }
  // Constant-time compare: an early-exit comparison (===) returns faster the
  // earlier the first wrong byte is, letting an attacker recover the digest
  // byte-by-byte from response times. This checks every byte unconditionally.
  return timingSafeEqual(received, expected);
}
