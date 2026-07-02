/**
 * Composition root — the only place where concrete adapters meet domain services.
 * Phase 0 behavior: build one snapshot summary from the paper broker, send it
 * (WhatsApp if configured, console otherwise), exit.
 */
import { pino } from 'pino';
import { loadConfig } from './config.js';
import { SummaryService } from '../domain/services/summary-service.js';
import { PaperBrokerAdapter } from '../adapters/broker-paper/paper-broker-adapter.js';
import { SystemClock } from '../adapters/clock-system/system-clock.js';
import { ConsoleMessagingAdapter } from '../adapters/messaging-console/console-messaging-adapter.js';
import { WhatsAppAdapter } from '../adapters/messaging-whatsapp/whatsapp-adapter.js';

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

const summaryService = new SummaryService(broker, clock, config.timeZone);

try {
  const text = await summaryService.buildSnapshotSummary();
  await messaging.sendMessage(recipient, text);
  logger.info(
    {
      component: 'app',
      transport: config.whatsapp ? 'whatsapp' : 'console',
      chars: text.length,
    },
    'summary sent',
  );
} catch (error) {
  logger.error({ component: 'app', err: error }, 'summary failed');
  process.exitCode = 1;
}
