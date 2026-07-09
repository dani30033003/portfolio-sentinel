function prop(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

/**
 * Pulls sender phone numbers out of a WhatsApp Cloud API webhook payload:
 * entry[].changes[].value.messages[].from. The payload is untrusted input, so
 * every level is checked rather than cast — an unexpected shape (e.g. a
 * status-only delivery receipt with no "messages" field) yields an empty
 * array instead of throwing.
 */
export function extractSenders(payload: unknown): string[] {
  const senders: string[] = [];

  const entries = prop(payload, 'entry');
  if (!Array.isArray(entries)) return senders;

  for (const entry of entries) {
    const changes = prop(entry, 'changes');
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const messages = prop(prop(change, 'value'), 'messages');
      if (!Array.isArray(messages)) continue;

      for (const message of messages) {
        const from = prop(message, 'from');
        if (typeof from === 'string') senders.push(from);
      }
    }
  }

  return senders;
}
