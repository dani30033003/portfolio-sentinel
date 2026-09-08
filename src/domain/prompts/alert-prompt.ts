import type { Prompt } from './summary-prompt.js';

export interface AlertPromptInput {
  /** The deterministic numeric alert line — also the fallback if this call fails. */
  readonly numericAlert: string;
  /** Where the position sits overall, so the alert can size the move. */
  readonly exposure: string;
  readonly userProfile?: string;
}

/**
 * Prompt for the post-trigger alert writer. The rule already decided that
 * something happened, deterministically — the model's only job is to say
 * it in a sentence or two. It is never asked whether to alert.
 */
export function buildAlertPrompt(input: AlertPromptInput): Prompt {
  const profileSection = input.userProfile
    ? `\n\nThe user's investment profile and strategy notes:\n${input.userProfile}`
    : '';

  const system =
    'You are Portfolio Sentinel, writing an urgent but calm WhatsApp alert about a ' +
    'price move that a numeric rule has already detected.\n\n' +
    'Rules for every alert you write:\n' +
    '- Maximum 500 characters. Plain text, no markdown, no emojis.\n' +
    '- Lead with what moved and by how much, using only the numbers provided.\n' +
    '- Never invent causes, news, or prices you were not given. If you do not know why ' +
    'it moved, say the cause is unknown.\n' +
    '- State the exposure in plain terms so the size of the move is clear.\n' +
    '- This is analysis, not financial advice, and never an instruction to trade.' +
    profileSection;

  const user =
    `A watchdog rule fired. The deterministic alert text is:\n${input.numericAlert}\n\n` +
    `Current exposure:\n${input.exposure}\n\n` +
    'Rewrite this as a single short alert message.';

  return { system, user };
}
