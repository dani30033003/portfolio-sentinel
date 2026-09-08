/**
 * Exact-match command classification, done in code before the LLM sees anything.
 * Inbound messages are untrusted, so what counts as a command is decided by a
 * lookup here rather than by a model. Everything that is not a known command
 * becomes a `question` — carrying the raw text, which downstream must treat as
 * untrusted user-role content and never as instructions.
 */
export type Command =
  | { command: 'status' }
  | { command: 'summary' }
  | { command: 'pause' }
  | { command: 'resume' }
  | { command: 'stats' }
  | { command: 'help' }
  | { command: 'question'; text: string }
  | { command: 'unknown' };

const EXACT_COMMANDS: Record<string, Command> = {
  status: { command: 'status' },
  summary: { command: 'summary' },
  pause: { command: 'pause' },
  resume: { command: 'resume' },
  stats: { command: 'stats' },
  help: { command: 'help' },
};

export function parseCommand(text: string): Command {
  const trimmed = text.trim();
  if (trimmed === '') return { command: 'unknown' };

  const exact = EXACT_COMMANDS[trimmed.toLowerCase()];
  if (exact) return exact;

  // Not a command, so it is a question for the LLM. The original text is kept
  // verbatim — casing and punctuation are the user's, and normalizing them
  // here would silently change what the model is asked.
  return { command: 'question', text: trimmed };
}
