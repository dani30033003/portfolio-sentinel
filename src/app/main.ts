/**
 * The sentinel process: scheduled summaries, a continuous watchdog poll loop,
 * inbound commands, and the nightly recommendation scoring job — one process,
 * one composition root (see wiring.ts).
 *
 * It degrades instead of refusing to start. No WhatsApp credentials means
 * messages print to the console; no LLM key means deterministic numeric text;
 * no webhook config means the console driver is the only inbound channel.
 * The point is that the whole system can be run and watched with no secrets.
 */
import cron from 'node-cron';
import { buildContainer, loadEnvFile } from './wiring.js';
import { createCommandHandler } from './command-handler.js';
import { startConsoleDriver } from './console-driver.js';
import { buildWebhookServer } from '../webhook/server.js';
import type { Command } from '../webhook/command-parser.js';

loadEnvFile();

const container = buildContainer('portfolio-sentinel');
const { config, logger } = container;
const handleCommand = createCommandHandler(container);

/** Runs one watchdog cycle and logs what it did. Never throws. */
async function poll(): Promise<void> {
  try {
    const result = await container.watchdog.poll();
    if (result.sent.length > 0 || result.suppressed.length > 0 || result.errors.length > 0) {
      logger.info(
        {
          component: 'watchdog',
          triggers: result.triggers.length,
          sent: result.sent.map((alert) => `${alert.ruleId}:${alert.subject}`),
          suppressed: result.suppressed.map((s) => `${s.trigger.ruleId}:${s.reason}`),
          errors: result.errors,
        },
        'watchdog poll',
      );
    }
  } catch (error) {
    logger.error({ component: 'watchdog', err: describe(error) }, 'watchdog poll failed');
  }
}

/**
 * Self-scheduling timeout rather than setInterval: a poll that takes longer
 * than the interval (a slow LLM alert) must not have the next one start on top
 * of it. The next tick is scheduled only after this one finishes.
 */
let pollTimer: NodeJS.Timeout | undefined;
function scheduleNextPoll(): void {
  pollTimer = setTimeout(() => {
    void poll().finally(scheduleNextPoll);
  }, config.watchdog.pollIntervalMs);
}

async function sendScheduledSummary(): Promise<void> {
  try {
    const result = await container.summaries.buildSummary('scheduled');
    await container.messaging.sendMessage(container.recipient, result.text);
    container.state.recordSummary(container.clock.now());
    logger.info(
      {
        component: 'scheduler',
        summarySource: result.source,
        ...(result.llmError ? { llmError: result.llmError } : {}),
        ...(result.storageError ? { storageError: result.storageError } : {}),
      },
      'scheduled summary sent',
    );
  } catch (error) {
    logger.error({ component: 'scheduler', err: describe(error) }, 'scheduled summary failed');
  }
}

const cronTasks = [
  ...config.summarySchedules.map((expression) =>
    cron.schedule(expression, () => void sendScheduledSummary(), { timezone: config.timeZone }),
  ),
  cron.schedule(
    config.scoringSchedule,
    () => {
      void container.recommendations
        .scoreDue(container.broker, container.clock.now())
        .then((result) => {
          if (result.scored > 0 || result.errors.length > 0) {
            logger.info({ component: 'scoring', ...result }, 'recommendation scoring run');
          }
        });
    },
    { timezone: config.timeZone },
  ),
];

// The webhook only starts when it can both authenticate inbound POSTs and
// reply — a half-configured webhook is a security hole, not a degraded mode.
const webhookServer =
  config.webhook && config.whatsapp
    ? buildWebhookServer({
        verifyToken: config.webhook.verifyToken,
        appSecret: config.webhook.appSecret,
        senderWhitelist: [config.whatsapp.to],
        logger,
        onCommand: (sender: string, command: Command) => {
          // Fire-and-forget: server.ts has already answered Meta with a 200,
          // and handling can take as long as an LLM call.
          void handleCommand(command)
            .then((reply) => container.messaging.sendMessage(sender, reply))
            .catch((error: unknown) => {
              logger.error({ component: 'webhook', err: describe(error) }, 'command failed');
            });
        },
      })
    : undefined;

let stopConsole: (() => void) | undefined = undefined;
let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ component: 'app', signal }, 'shutting down');

  clearTimeout(pollTimer);
  for (const task of cronTasks) void task.stop();
  stopConsole?.();

  void Promise.resolve(webhookServer?.close()).finally(() => {
    container.close();
    process.exit(0);
  });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => shutdown(signal));
}

if (webhookServer) {
  await webhookServer.listen({ port: config.webhook?.port ?? 3000, host: '0.0.0.0' });
  logger.info({ component: 'webhook', port: config.webhook?.port }, 'webhook listening');
}

// First poll immediately, so the price history starts filling and STATUS has
// something true to report before the first interval elapses.
await poll();
scheduleNextPoll();

logger.info(
  {
    component: 'app',
    transport: config.whatsapp ? 'whatsapp' : 'console',
    llmProvider: config.llm.provider,
    pollIntervalMs: config.watchdog.pollIntervalMs,
    summarySchedules: config.summarySchedules,
    inbound: webhookServer ? 'webhook + console' : 'console',
  },
  'portfolio sentinel started',
);

stopConsole = startConsoleDriver({
  container,
  handleCommand,
  pollNow: poll,
  onQuit: () => shutdown('console quit'),
});

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
