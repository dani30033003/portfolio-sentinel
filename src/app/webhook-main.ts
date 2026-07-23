/**
 * Composition root for the inbound WhatsApp webhook — a long-running
 * process (Fastify .listen()), separate from main.ts, which builds one
 * summary and exits. Requires both `whatsapp` (to reply) and `webhook`
 * (to authenticate inbound POSTs) to be configured; refuses to start
 * otherwise, since a webhook with no way to verify senders or reply is
 * pointless rather than degraded.
 */
import { pino } from 'pino';
import { ConfigError, loadConfig } from './config.js';
import { buildWebhookServer } from '../webhook/server.js';
import type { Command } from '../webhook/command-parser.js';
import type { LLMPort } from '../domain/ports/llm-port.js';
import { SummaryService, type LlmSummaryConfig } from '../domain/services/summary-service.js';
import { PaperBrokerAdapter } from '../adapters/broker-paper/paper-broker-adapter.js';
import { SystemClock } from '../adapters/clock-system/system-clock.js';
import { WhatsAppAdapter } from '../adapters/messaging-whatsapp/whatsapp-adapter.js';
import { AnthropicAdapter } from '../adapters/llm-anthropic/anthropic-adapter.js';
import { GeminiAdapter } from '../adapters/llm-gemini/gemini-adapter.js';
import { SqliteStorageAdapter } from '../adapters/storage-sqlite/sqlite-storage-adapter.js';

try {
  process.loadEnvFile();
} catch {
  // no .env file: fine, loadConfig() below will surface what's actually missing
}

const logger = pino({ name: 'portfolio-sentinel-webhook' });
const config = loadConfig();

if (!config.whatsapp || !config.webhook) {
  throw new ConfigError(
    'webhook-main requires WHATSAPP_TOKEN/PHONE_NUMBER_ID/TO (to reply) and ' +
      'WHATSAPP_VERIFY_TOKEN/APP_SECRET (to authenticate inbound POSTs) to all be set.',
  );
}
const { whatsapp, webhook } = config;

const broker = new PaperBrokerAdapter();
const clock = new SystemClock();
const messaging = new WhatsAppAdapter(whatsapp);

let llm: LLMPort | undefined;
if (config.llm.provider === 'anthropic') {
  llm = new AnthropicAdapter(config.llm);
} else if (config.llm.provider === 'gemini') {
  llm = new GeminiAdapter(config.llm);
}
const llmSummaryConfig: LlmSummaryConfig | undefined =
  llm && config.llm.provider !== 'none' ? { llm, timeoutMs: config.llm.timeoutMs } : undefined;

const storage = new SqliteStorageAdapter(config.dbPath);
const summaryService = new SummaryService(
  broker,
  clock,
  config.timeZone,
  llmSummaryConfig,
  storage,
);

/**
 * Does the actual work for a classified command. Runs after buildWebhookServer
 * has already acked Meta's POST with a 200 — this is not on that response's
 * critical path, since a summary can involve an LLM call up to LLM_TIMEOUT_MS.
 */
async function handleCommand(sender: string, command: Command): Promise<void> {
  switch (command.command) {
    case 'summary': {
      const result = await summaryService.buildSummary('on_demand');
      await messaging.sendMessage(sender, result.text);
      if (result.llmError) {
        logger.warn(
          { component: 'webhook', llmProvider: config.llm.provider, err: result.llmError },
          'LLM summary failed — sent numeric fallback',
        );
      }
      if (result.storageError) {
        logger.warn(
          { component: 'webhook', err: result.storageError },
          'summary sent but not persisted',
        );
      }
      return;
    }
    case 'status': {
      // Placeholder: no gateway-session/last-poll tracking exists yet.
      const serverTime = clock.now().toISOString();
      await messaging.sendMessage(
        sender,
        `Portfolio Sentinel is running (no detailed health data yet). Server time: ${serverTime}`,
      );
      return;
    }
    case 'unknown': {
      await messaging.sendMessage(sender, 'Unrecognized command. Try STATUS or SUMMARY.');
      return;
    }
  }
}

const app = buildWebhookServer({
  verifyToken: webhook.verifyToken,
  appSecret: webhook.appSecret,
  senderWhitelist: [whatsapp.to],
  logger,
  onCommand: (sender, command) => {
    // Fire-and-forget: server.ts's handler is synchronous and already sent
    // its 200 by the time this runs. Errors are caught here, not left to
    // become an unhandled rejection.
    void handleCommand(sender, command).catch((error: unknown) => {
      logger.error(
        { component: 'webhook', err: error instanceof Error ? error.message : String(error) },
        'command handling failed',
      );
    });
  },
});

// Long-running process: close the server and flush the SQLite WAL on the
// signals a container/orchestrator uses to stop us, so we don't leave a
// -wal file behind or drop an in-flight write.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info({ component: 'webhook', signal }, 'shutting down');
    void app.close().finally(() => {
      storage.close();
      process.exit(0);
    });
  });
}

try {
  await app.listen({ port: webhook.port, host: '0.0.0.0' });
  logger.info({ component: 'webhook', port: webhook.port }, 'webhook server listening');
} catch (error) {
  logger.error(
    { component: 'webhook', err: error instanceof Error ? error.message : String(error) },
    'failed to start webhook server',
  );
  process.exitCode = 1;
}
