/**
 * Build one summary, send it, exit. The smallest possible run of the system —
 * useful for cron-from-outside deployments, for checking credentials, and as
 * the thing you point at when explaining what the scheduled job actually does.
 */
import { buildContainer, loadEnvFile } from './wiring.js';

loadEnvFile();

const container = buildContainer('portfolio-sentinel-summary');
const { logger, config } = container;

try {
  const result = await container.summaries.buildSummary('scheduled');
  await container.messaging.sendMessage(container.recipient, result.text);

  if (result.llmError) {
    logger.warn(
      { component: 'app', llmProvider: config.llm.provider, err: result.llmError },
      'LLM summary failed — sent numeric fallback',
    );
  }
  if (result.storageError) {
    logger.warn({ component: 'app', err: result.storageError }, 'summary sent but not persisted');
  }
  logger.info(
    {
      component: 'app',
      transport: config.whatsapp ? 'whatsapp' : 'console',
      summarySource: result.source,
      chars: result.text.length,
    },
    'summary sent',
  );
} catch (error) {
  logger.error({ component: 'app', err: error }, 'summary failed');
  process.exitCode = 1;
} finally {
  container.close();
}
