/**
 * Composition root — the only place where concrete adapters meet domain services.
 * Phase 1 (in progress): build one summary — LLM-written if a provider is
 * configured, deterministic numeric snapshot otherwise or on any LLM failure —
 * and send it (WhatsApp if configured, console otherwise).
 */
import { pino } from 'pino';
import { loadConfig } from './config.js';
import type { LLMPort } from '../domain/ports/llm-port.js';
import { SummaryService, type LlmSummaryConfig } from '../domain/services/summary-service.js';
import { PaperBrokerAdapter } from '../adapters/broker-paper/paper-broker-adapter.js';
import { SystemClock } from '../adapters/clock-system/system-clock.js';
import { ConsoleMessagingAdapter } from '../adapters/messaging-console/console-messaging-adapter.js';
import { WhatsAppAdapter } from '../adapters/messaging-whatsapp/whatsapp-adapter.js';
import { AnthropicAdapter } from '../adapters/llm-anthropic/anthropic-adapter.js';
import { GeminiAdapter } from '../adapters/llm-gemini/gemini-adapter.js';
import { SqliteStorageAdapter } from '../adapters/storage-sqlite/sqlite-storage-adapter.js';

// Node 22+ loads .env natively — no dotenv dependency needed.
try {
  process.loadEnvFile();
} catch {
  // no .env file: fine, config falls back to console dry-run mode
}

const logger = pino({ name: 'portfolio-sentinel' });
const config = loadConfig();

const broker = new PaperBrokerAdapter();
const clock = new SystemClock();
const messaging = config.whatsapp
  ? new WhatsAppAdapter(config.whatsapp)
  : new ConsoleMessagingAdapter();
const recipient = config.whatsapp?.to ?? 'console';

let llm: LLMPort | undefined;
if (config.llm.provider === 'anthropic') {
  llm = new AnthropicAdapter(config.llm);
} else if (config.llm.provider === 'gemini') {
  llm = new GeminiAdapter(config.llm);
}
const llmSummaryConfig: LlmSummaryConfig | undefined =
  llm && config.llm.provider !== 'none'
    ? { llm, timeoutMs: config.llm.timeoutMs }
    : undefined;

const storage = new SqliteStorageAdapter(config.dbPath);
const summaryService = new SummaryService(
  broker,
  clock,
  config.timeZone,
  llmSummaryConfig,
  storage,
);

try {
  const result = await summaryService.buildSummary('scheduled');
  await messaging.sendMessage(recipient, result.text);
  if (result.llmError) {
    logger.warn(
      { component: 'app', llmProvider: config.llm.provider, err: result.llmError },
      'LLM summary failed — sent numeric fallback',
    );
  }
  if (result.storageError) {
    logger.warn(
      { component: 'app', err: result.storageError },
      'summary sent but not persisted',
    );
  }
  logger.info(
    {
      component: 'app',
      transport: config.whatsapp ? 'whatsapp' : 'console',
      summarySource: result.source,
      llmProvider: config.llm.provider,
      chars: result.text.length,
    },
    'summary sent',
  );
} catch (error) {
  logger.error({ component: 'app', err: error }, 'summary failed');
  process.exitCode = 1;
} finally {
  // Single-shot process: flush WAL and release the file before exiting.
  storage.close();
}
