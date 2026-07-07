import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifySignature } from '../../src/webhook/verify-signature.js';
import { buildWebhookServer } from '../../src/webhook/server.js';

const APP_SECRET = 'test-app-secret';

/** Compute the header value exactly the way Meta does. */
const sign = (body: string, secret = APP_SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('verifySignature', () => {
  const body = Buffer.from('{"entry":[{"id":"0"}]}');

  it('accepts a signature computed with the shared secret', () => {
    expect(verifySignature(body, sign(body.toString()), APP_SECRET)).toBe(true);
  });

  it('rejects when the body was tampered with after signing', () => {
    const signatureForOriginal = sign(body.toString());
    const tampered = Buffer.from('{"entry":[{"id":"1"}]}'); // one character changed
    expect(verifySignature(tampered, signatureForOriginal, APP_SECRET)).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    expect(verifySignature(body, sign(body.toString(), 'not-the-secret'), APP_SECRET)).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(verifySignature(body, undefined, APP_SECRET)).toBe(false);
  });

  it('rejects a header without the sha256= prefix', () => {
    const bare = createHmac('sha256', APP_SECRET).update(body).digest('hex');
    expect(verifySignature(body, bare, APP_SECRET)).toBe(false);
  });

  it('rejects malformed hex and wrong-length digests without throwing', () => {
    expect(verifySignature(body, 'sha256=zzzz-not-hex', APP_SECRET)).toBe(false);
    expect(verifySignature(body, 'sha256=abcd12', APP_SECRET)).toBe(false);
    expect(verifySignature(body, 'sha256=', APP_SECRET)).toBe(false);
  });
});

describe('POST /webhook (signature enforcement)', () => {
  const build = () =>
    buildWebhookServer({ verifyToken: 'irrelevant-here', appSecret: APP_SECRET });

  const VALID_BODY = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

  const post = (body: string, headers: Record<string, string>) =>
    build().inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'content-type': 'application/json', ...headers },
      payload: body,
    });

  it('acknowledges a correctly signed payload with 200', async () => {
    const res = await post(VALID_BODY, { 'x-hub-signature-256': sign(VALID_BODY) });
    expect(res.statusCode).toBe(200);
  });

  it('rejects an unsigned payload with 401', async () => {
    const res = await post(VALID_BODY, {});
    expect(res.statusCode).toBe(401);
  });

  it('rejects a forged signature with 401', async () => {
    const res = await post(VALID_BODY, {
      'x-hub-signature-256': sign(VALID_BODY, 'attacker-secret'),
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a payload modified after signing with 401', async () => {
    const original = JSON.stringify({ entry: ['real'] });
    const modified = JSON.stringify({ entry: ['fake'] });
    const res = await post(modified, { 'x-hub-signature-256': sign(original) });
    expect(res.statusCode).toBe(401);
  });

  it('rejects valid-signature-but-broken-JSON with 400, not a crash', async () => {
    const broken = '{"entry": [unclosed';
    const res = await post(broken, { 'x-hub-signature-256': sign(broken) });
    expect(res.statusCode).toBe(400);
  });
});
