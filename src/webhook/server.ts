import Fastify, { type FastifyInstance } from 'fastify';

export interface WebhookServerOptions {
  /**
   * Shared secret for Meta's one-time verification handshake. We invent this
   * value and type it into both .env and the Meta dashboard — it is not a
   * Meta-issued credential.
   */
  verifyToken: string;
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

  return app;
}
