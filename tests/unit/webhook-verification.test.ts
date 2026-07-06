import { describe, expect, it } from 'vitest';
import { buildWebhookServer } from '../../src/webhook/server.js';

const VERIFY_TOKEN = 'correct-verify-token';

const build = () => buildWebhookServer({ verifyToken: VERIFY_TOKEN });

// Meta's verification handshake: GET with hub.* query params; we must echo
// hub.challenge back as plain text iff hub.verify_token matches our config.
describe('GET /webhook (Meta verification handshake)', () => {
  it('echoes the challenge when mode and token are correct', async () => {
    const res = await build().inject({
      method: 'GET',
      url: '/webhook',
      query: {
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': '1158201444',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('1158201444'); // exact echo — not JSON-wrapped
  });

  it('rejects a wrong verify token with 403 and no challenge leak', async () => {
    const res = await build().inject({
      method: 'GET',
      url: '/webhook',
      query: {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'attacker-guess',
        'hub.challenge': '1158201444',
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain('1158201444');
  });

  it('rejects when hub.mode is not "subscribe"', async () => {
    const res = await build().inject({
      method: 'GET',
      url: '/webhook',
      query: {
        'hub.mode': 'unsubscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': '1158201444',
      },
    });

    expect(res.statusCode).toBe(403);
  });

  it('rejects a request with no query params at all', async () => {
    const res = await build().inject({ method: 'GET', url: '/webhook' });
    expect(res.statusCode).toBe(403);
  });
});
