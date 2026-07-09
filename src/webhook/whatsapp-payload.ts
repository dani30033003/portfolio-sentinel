function prop(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

export interface InboundMessage {
  from: string;
  /** Absent for non-text messages (images, reactions, etc.) — nothing to parse as a command. */
  text?: string;
}

/**
 * Pulls inbound messages out of a WhatsApp Cloud API webhook payload:
 * entry[].changes[].value.messages[].{from,text.body}. The payload is
 * untrusted input, so every level is checked rather than cast — an
 * unexpected shape (e.g. a status-only delivery receipt with no "messages"
 * field) yields an empty array instead of throwing.
 */
export function extractMessages(payload: unknown): InboundMessage[] {
  const result: InboundMessage[] = [];

  const entries = prop(payload, 'entry');
  if (!Array.isArray(entries)) return result;

  for (const entry of entries) {
    const changes = prop(entry, 'changes');
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const messages = prop(prop(change, 'value'), 'messages');
      if (!Array.isArray(messages)) continue;

      for (const message of messages) {
        const from = prop(message, 'from');
        if (typeof from !== 'string') continue;

        const body = prop(prop(message, 'text'), 'body');
        result.push(typeof body === 'string' ? { from, text: body } : { from });
      }
    }
  }

  return result;
}

/** Sender numbers only — a thin projection of extractMessages for callers that don't need message text. */
export function extractSenders(payload: unknown): string[] {
  return extractMessages(payload).map((message) => message.from);
}
