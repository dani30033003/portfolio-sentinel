import Fastify, { type FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { verifySignature } from './verify-signature.js';
import { isWhitelistedSender } from './sender-whitelist.js';
import { extractSenders } from './whatsapp-payload.js';

export interface WebhookServerOptions {
  /**
   * Shared secret for Meta's one-time verification handshake. We invent this
   * value and type it into both .env and the Meta dashboard — it is not a
   * Meta-issued credential.
   */
  verifyToken: string;
  /**
   * Meta-issued app secret (dashboard → App settings → Basic). Keys the HMAC
   * that authenticates every inbound POST.
   */
  appSecret: string;
  /**
   * Senders allowed to reach anything past authentication. Single-tenant, so
   * this is normally just [WHATSAPP_TO] — the one number this deployment
   * talks to. Messages from anyone else are dropped before any processing.
   */
  senderWhitelist: readonly string[];
  /** Optional: rejected senders are logged at debug only (never message bodies). */
  logger?: Logger;
}

/** Meta sends the hub.* params with literal dots in the key names. */
interface VerificationQuery {
  'hub.mode'?: string;
  'hub.verify_token'?: string;
  'hub.challenge'?: string;
}

/**
 * Builds the inbound-webhook server without starting it. The composition
 * root calls .listen(); tests call .inject() and never touch the network.
 */
export function buildWebhookServer(options: WebhookServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });

  // Replace Fastify's default JSON parsing with "hand me the raw bytes".
  // The HMAC was computed by Meta over the wire bytes, so we must verify
  // against exactly those bytes — parsing to JSON and re-serializing could
  // change key order or whitespace and break the digest. Handlers receive
  // request.body as a Buffer and parse it themselves AFTER authentication.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_request, rawBody, done) => {
      done(null, rawBody);
    },
  );

  // Meta's subscription handshake: prove we own this URL by echoing the
  // challenge, but only if the caller knows our verify token. A plain
  // equality check is fine here (unlike the POST signature): succeeding at
  // this handshake only confirms a subscription we configured ourselves.
  app.get<{ Querystring: VerificationQuery }>('/webhook', (request, reply) => {
    const query = request.query;
    const isValid =
      query['hub.mode'] === 'subscribe' &&
      query['hub.verify_token'] === options.verifyToken &&
      typeof query['hub.challenge'] === 'string';

    if (!isValid) {
      return reply.code(403).send('Forbidden');
    }
    // Meta expects the raw challenge string back, not JSON.
    return reply.type('text/plain').send(query['hub.challenge']);
  });

  // Inbound events. Order is the security story: authenticate the raw bytes
  // first; only then spend any parsing effort on them.
  app.post('/webhook', (request, reply) => {
    const rawBody = request.body as Buffer; // guaranteed by the parser above

    const header = request.headers['x-hub-signature-256'];
    // A duplicated header arrives as string[] — treat anything but a single
    // string as unauthenticated rather than guessing which copy to trust.
    const signature = typeof header === 'string' ? header : undefined;

    if (!verifySignature(rawBody, signature, options.appSecret)) {
      return reply.code(401).send();
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return reply.code(400).send();
    }

    const senders = extractSenders(payload);
    const rejected = senders.filter((from) => !isWhitelistedSender(from, options.senderWhitelist));
    if (rejected.length > 0) {
      options.logger?.debug(
        { component: 'webhook', rejectedSenders: rejected },
        'dropped message from non-whitelisted sender',
      );
    }

    // Step ④ (payload → command parser, for whitelisted senders only) plugs
    // in here. Until then: authenticated, whitelist-checked, acknowledged,
    // ignored.
    void payload;
    return reply.code(200).send();
  });

  return app;
}
