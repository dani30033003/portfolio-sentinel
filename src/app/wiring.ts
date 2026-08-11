import { pino, type DestinationStream, type Logger } from 'pino';
import { loadConfig, type AppConfig } from './config.js';
import type { LLMPort } from '../domain/ports/llm-port.js';
import type { MessagingPort, PhoneNumber } from '../domain/ports/messaging-port.js';
import { SummaryService, type LlmSummaryConfig } from '../domain/services/summary-service.js';
import { QueryService } from '../domain/services/query-service.js';
import { StatusService } from '../domain/services/status-service.js';
import { SystemState } from '../domain/services/system-state.js';
import { WatchdogService } from '../domain/services/watchdog-service.js';
import { RecommendationTracker } from '../domain/services/recommendation-tracker.js';
import { PaperBrokerAdapter } from '../adapters/broker-paper/paper-broker-adapter.js';
import { SystemClock } from '../adapters/clock-system/system-clock.js';
import { ConsoleMessagingAdapter } from '../adapters/messaging-console/console-messaging-adapter.js';
import { WhatsAppAdapter } from '../adapters/messaging-whatsapp/whatsapp-adapter.js';
import { AnthropicAdapter } from '../adapters/llm-anthropic/anthropic-adapter.js';
import { GeminiAdapter } from '../adapters/llm-gemini/gemini-adapter.js';
import { SqliteStorageAdapter } from '../adapters/storage-sqlite/sqlite-storage-adapter.js';

export interface Container {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly clock: SystemClock;
  readonly broker: PaperBrokerAdapter;
  readonly storage: SqliteStorageAdapter;
  readonly messaging: MessagingPort;
  /** Where unsolicited messages (summaries, alerts) go. */
  readonly recipient: PhoneNumber;
  readonly state: SystemState;
  readonly summaries: SummaryService;
  readonly watchdog: WatchdogService;
  readonly queries: QueryService;
  readonly status: StatusService;
  readonly recommendations: RecommendationTracker;
  close(): void;
}

/** Node 22+ reads .env natively; no dotenv dependency. */
export function loadEnvFile(): void {
  try {
    process.loadEnvFile();
  } catch {
    // No .env: every entry point still runs, in console dry-run mode.
  }
}

/**
 * The composition root. The only place concrete adapters meet domain services,
 * and the only place that knows whether WhatsApp, an LLM or a database is
 * configured — every service below it sees ports and optional dependencies.
 */
/**
 * @param logStream where pino writes. Defaults to stdout; the MCP entry point
 *   passes stderr, because stdout there is the JSON-RPC channel and a stray log
 *   line would corrupt the protocol.
 */
export function buildContainer(name: string, logStream?: DestinationStream): Container {
  const logger = logStream ? pino({ name }, logStream) : pino({ name });
  const config = loadConfig();

  const clock = new SystemClock();
  const broker = new PaperBrokerAdapter({
    clock,
    simulator: config.simulator,
  });
  const storage = new SqliteStorageAdapter(config.dbPath);
  const messaging: MessagingPort = config.whatsapp
    ? new WhatsAppAdapter(config.whatsapp)
    : new ConsoleMessagingAdapter();
  const recipient = config.whatsapp?.to ?? 'console';
  const state = new SystemState(clock.now());

  const llmConfig = buildLlmConfig(config);

  const summaries = new SummaryService(broker, clock, config.timeZone, llmConfig, storage);
  const queries = new QueryService(broker, clock, config.timeZone, llmConfig, storage);
  const status = new StatusService(clock, state, config.timeZone, storage);
  const recommendations = new RecommendationTracker(storage);
  const watchdog = new WatchdogService(
    broker,
    clock,
    messaging,
    recipient,
    state,
    {
      timeZone: config.timeZone,
      rules: {
        positionDropTiers: config.watchdog.positionDropTiers,
        positionWindowMs: config.watchdog.positionWindowMs,
        portfolioDropTiers: config.watchdog.portfolioDropTiers,
        levels: config.watchdog.levels,
      },
      policy: {
        cooldownMs: config.watchdog.cooldownMs,
        dailyCap: config.watchdog.dailyCap,
      },
    },
    llmConfig,
    storage,
  );

  return {
    config,
    logger,
    clock,
    broker,
    storage,
    messaging,
    recipient,
    state,
    summaries,
    watchdog,
    queries,
    status,
    recommendations,
    close: () => {
      storage.close();
    },
  };
}

/** Undefined here is a supported mode, not a failure: every LLM path has a
 * deterministic fallback, so the whole system runs with no provider at all. */
function buildLlmConfig(config: AppConfig): LlmSummaryConfig | undefined {
  if (config.llm.provider === 'none') return undefined;

  const llm: LLMPort =
    config.llm.provider === 'anthropic'
      ? new AnthropicAdapter(config.llm)
      : new GeminiAdapter(config.llm);

  return {
    llm,
    timeoutMs: config.llm.timeoutMs,
    ...(config.userProfile !== undefined ? { userProfile: config.userProfile } : {}),
  };
}
