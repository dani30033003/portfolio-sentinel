import type { MessagingPort, PhoneNumber } from '../../domain/ports/messaging-port.js';

/**
 * Dry-run messaging adapter: prints instead of sending. Used when WhatsApp
 * credentials are absent, and in any test that would otherwise message a
 * real phone (CLAUDE.md: never send to a real number from tests).
 */
export class ConsoleMessagingAdapter implements MessagingPort {
  async sendMessage(to: PhoneNumber, text: string): Promise<void> {
    process.stdout.write(`\n--- dry-run message to ${to} ---\n${text}\n--- end message ---\n`);
  }
}
