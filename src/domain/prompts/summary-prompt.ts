/**
 * Typed prompt template for the LLM-written portfolio summary (CLAUDE.md style:
 * prompts live here as functions with unit tests asserting required elements).
 * The LLM only rewrites data we computed — it never decides what the numbers are.
 */
export interface SummaryPromptInput {
  /** The deterministic numeric snapshot (also the fallback message). */
  readonly snapshot: string;
  /** Optional strategy notes from the user profile, e.g. "long-term investor". */
  readonly userProfile?: string;
}

export interface Prompt {
  readonly system: string;
  readonly user: string;
}

export function buildSummaryPrompt(input: SummaryPromptInput): Prompt {
  const profileSection = input.userProfile
    ? `\n\nThe user's investment profile and strategy notes:\n${input.userProfile}`
    : '';

  const system =
    'You are Portfolio Sentinel, a personal portfolio-monitoring assistant that writes ' +
    'WhatsApp messages summarizing a brokerage account.\n\n' +
    'Rules for every message you write:\n' +
    '- Factual tone. No hype, no exclamation marks, no emojis.\n' +
    '- Use only the numbers provided; never invent prices, news, or causes you were not given.\n' +
    '- Acknowledge uncertainty where it exists.\n' +
    '- Your output is analysis and considerations, not financial advice. Do not present ' +
    'recommendations as certainties; state reasoning and confidence.\n' +
    '- Keep it compact: it must fit in one or two WhatsApp messages (about 1000 characters ' +
    'each). Plain text only, no markdown.' +
    profileSection;

  const user =
    'Write the portfolio summary message based on this snapshot:\n\n' + input.snapshot;

  return { system, user };
}
