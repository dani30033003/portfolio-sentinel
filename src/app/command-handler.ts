import type { Container } from './wiring.js';
import type { Command } from '../webhook/command-parser.js';

const HELP_TEXT = [
  'Portfolio Sentinel commands:',
  'SUMMARY — portfolio snapshot now',
  'STATUS — system health',
  'STATS — how past recommendations have scored',
  'PAUSE / RESUME — mute or unmute alerts',
  'HELP — this list',
  'Anything else is treated as a question about your portfolio.',
].join('\n');

/**
 * One dispatch table for every inbound channel. WhatsApp and the console
 * driver both call this, so a command cannot behave differently depending on
 * where it arrived from — and neither transport knows what a SummaryService is.
 *
 * Returns the reply text; sending it is the caller's job, because the caller
 * knows who asked.
 */
export function createCommandHandler(container: Container) {
  const { summaries, status, queries, state, logger, config } = container;

  return async function handleCommand(command: Command): Promise<string> {
    switch (command.command) {
      case 'summary': {
        const result = await summaries.buildSummary('on_demand');
        state.recordSummary(container.clock.now());
        if (result.llmError) {
          logger.warn(
            { component: 'commands', llmProvider: config.llm.provider, err: result.llmError },
            'LLM summary failed — sent numeric fallback',
          );
        }
        if (result.storageError) {
          logger.warn(
            { component: 'commands', err: result.storageError },
            'summary sent but not persisted',
          );
        }
        return result.text;
      }

      case 'status':
        return status.renderStatus();

      case 'stats':
        return status.renderStats();

      case 'pause':
        return state.setPaused(true)
          ? 'Alerts paused. Send RESUME to turn them back on.'
          : 'Alerts are already paused.';

      case 'resume':
        return state.setPaused(false)
          ? 'Alerts resumed.'
          : 'Alerts are already active.';

      case 'help':
        return HELP_TEXT;

      case 'question': {
        const result = await queries.answer(command.text);
        if (result.llmError) {
          logger.warn(
            { component: 'commands', err: result.llmError },
            'LLM query failed — sent snapshot fallback',
          );
        }
        return result.text;
      }

      case 'unknown':
        return HELP_TEXT;
    }
  };
}
