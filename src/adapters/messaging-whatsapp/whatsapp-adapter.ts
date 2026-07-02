import type { MessagingPort, PhoneNumber } from '../../domain/ports/messaging-port.js';
import { MessageSendError } from '../../domain/errors.js';

export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  /** Graph API version; bump deliberately, Meta sunsets old ones. */
  apiVersion?: string;
}

/**
 * Outbound-only WhatsApp Cloud API adapter (inbound webhook arrives in Phase 1).
 * One POST to the Graph API — no SDK needed. Transport errors are translated
 * into MessageSendError at this boundary; nothing above sees fetch/HTTP details.
 */
export class WhatsAppAdapter implements MessagingPort {
  private readonly url: string;

  constructor(private readonly config: WhatsAppConfig) {
    const version = config.apiVersion ?? 'v23.0';
    this.url = `https://graph.facebook.com/${version}/${config.phoneNumberId}/messages`;
  }

  async sendMessage(to: PhoneNumber, text: string): Promise<void> {
    let response: Response;
    try {
      response = await fetch(this.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text },
        }),
      });
    } catch (cause) {
      throw new MessageSendError(
        `WhatsApp send failed before reaching the API: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '<unreadable body>');
      throw new MessageSendError(`WhatsApp API responded ${response.status}: ${detail}`);
    }
  }
}
