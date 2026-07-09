import { createHmac } from 'node:crypto';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { buildWebhookServer } from '../../src/webhook/server.js';
import type { Command } from '../../src/webhook/command-parser.js';

const APP_SECRET = 'test-app-secret';
const OWNER = '15550001111';
const STRANGER = '15559998888';

const sign = (body: string) => `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;

type OnCommandMock = Mock<(sender: string, command: Command) => void>;

const build = (onCommand: OnCommandMock) =>
  buildWebhookServer({
    verifyToken: 'unused-here',
    appSecret: APP_SECRET,
    senderWhitelist: [OWNER],
    onCommand,
  });

const post = (app: ReturnType<typeof build>, body: string) =>
  app.inject({
    method: 'POST',
    url: '/webhook',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
    payload: body,
  });

const messageBody = (from: string, text: string) =>
  JSON.stringify({
    entry: [
      { changes: [{ value: { messages: [{ from, id: 'wamid.x', type: 'text', text: { body: text } }] } }] },
    ],
  });

const imageMessageBody = (from: string) =>
  JSON.stringify({
    entry: [
      { changes: [{ value: { messages: [{ from, id: 'wamid.x', type: 'image' }] } }] },
    ],
  });

describe('POST /webhook (command dispatch)', () => {
  it('dispatches a recognized STATUS command from a whitelisted sender', async () => {
    const onCommand: OnCommandMock = vi.fn();
    const res = await post(build(onCommand), messageBody(OWNER, 'STATUS'));

    expect(res.statusCode).toBe(200);
    expect(onCommand).toHaveBeenCalledWith(OWNER, { command: 'status' });
  });

  it('dispatches an unrecognized command as { command: "unknown" }', async () => {
    const onCommand: OnCommandMock = vi.fn();
    const res = await post(build(onCommand), messageBody(OWNER, 'gibberish'));

    expect(res.statusCode).toBe(200);
    expect(onCommand).toHaveBeenCalledWith(OWNER, { command: 'unknown' });
  });

  it('never dispatches for a non-whitelisted sender, even with recognized text', async () => {
    const onCommand: OnCommandMock = vi.fn();
    const res = await post(build(onCommand), messageBody(STRANGER, 'SUMMARY'));

    expect(res.statusCode).toBe(200);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('does not dispatch for a message with no text (e.g. an image)', async () => {
    const onCommand: OnCommandMock = vi.fn();
    const res = await post(build(onCommand), imageMessageBody(OWNER));

    expect(res.statusCode).toBe(200);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('works without onCommand configured at all', async () => {
    const app = buildWebhookServer({
      verifyToken: 'unused-here',
      appSecret: APP_SECRET,
      senderWhitelist: [OWNER],
    });
    const res = await post(app, messageBody(OWNER, 'STATUS'));
    expect(res.statusCode).toBe(200);
  });
});
