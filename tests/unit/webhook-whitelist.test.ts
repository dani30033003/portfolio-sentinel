import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { createHmac } from 'node:crypto';
import { isWhitelistedSender } from '../../src/webhook/sender-whitelist.js';
import { extractSenders } from '../../src/webhook/whatsapp-payload.js';
import { buildWebhookServer } from '../../src/webhook/server.js';

// Obviously-fake numbers — never a real phone number in tests, per repo rules.
const OWNER = '15550001111';
const STRANGER = '15559998888';

describe('isWhitelistedSender', () => {
  it('accepts a number on the list', () => {
    expect(isWhitelistedSender(OWNER, [OWNER])).toBe(true);
  });

  it('rejects a number not on the list', () => {
    expect(isWhitelistedSender(STRANGER, [OWNER])).toBe(false);
  });

  it('rejects everything against an empty whitelist', () => {
    expect(isWhitelistedSender(OWNER, [])).toBe(false);
  });
});

describe('extractSenders', () => {
  const payloadWithSenders = (...senders: string[]) => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              messages: senders.map((from) => ({ from, id: 'wamid.x', type: 'text' })),
            },
          },
        ],
      },
    ],
  });

  it('extracts a single sender from a well-formed payload', () => {
    expect(extractSenders(payloadWithSenders(OWNER))).toEqual([OWNER]);
  });

  it('extracts multiple senders across messages', () => {
    expect(extractSenders(payloadWithSenders(OWNER, STRANGER))).toEqual([OWNER, STRANGER]);
  });

  it('returns empty for a status-only payload (no messages field)', () => {
    const statusPayload = {
      entry: [{ changes: [{ value: { statuses: [{ status: 'delivered' }] } }] }],
    };
    expect(extractSenders(statusPayload)).toEqual([]);
  });

  it.each([
    ['null', null],
    ['a string', 'not an object'],
    ['missing entry', {}],
    ['entry not an array', { entry: 'nope' }],
    ['changes not an array', { entry: [{ changes: 'nope' }] }],
    ['message missing from', { entry: [{ changes: [{ value: { messages: [{}] } }] }] }],
    [
      'from not a string',
      { entry: [{ changes: [{ value: { messages: [{ from: 12345 }] } }] }] },
    ],
  ])('returns empty rather than throwing for: %s', (_label, payload) => {
    expect(extractSenders(payload)).toEqual([]);
  });
});

describe('POST /webhook (sender whitelist)', () => {
  const APP_SECRET = 'test-app-secret';
  const sign = (body: string) => `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;

  const build = (senderWhitelist: string[], logger?: Logger) =>
    buildWebhookServer({ verifyToken: 'unused-here', appSecret: APP_SECRET, senderWhitelist, logger });

  const post = (app: ReturnType<typeof build>, body: string) =>
    app.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
      payload: body,
    });

  const bodyFrom = (from: string) =>
    JSON.stringify({
      entry: [{ changes: [{ value: { messages: [{ from, id: 'wamid.x', type: 'text' }] } }] }],
    });

  it('acks 200 and does not log for a whitelisted sender', async () => {
    const logger = { debug: vi.fn() } as unknown as Logger;
    const app = build([OWNER], logger);

    const res = await post(app, bodyFrom(OWNER));

    expect(res.statusCode).toBe(200);
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('still acks 200 for a non-whitelisted sender but logs the rejection at debug', async () => {
    const logger = { debug: vi.fn() } as unknown as Logger;
    const app = build([OWNER], logger);

    const res = await post(app, bodyFrom(STRANGER));

    expect(res.statusCode).toBe(200);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ component: 'webhook', rejectedSenders: [STRANGER] }),
      expect.any(String),
    );
  });

  it('works without a logger configured (rejection is simply silent)', async () => {
    const app = build([OWNER], undefined);
    const res = await post(app, bodyFrom(STRANGER));
    expect(res.statusCode).toBe(200);
  });
});
