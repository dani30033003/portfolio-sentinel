import type { RecommendationDirection } from '../entities/recommendation.js';

export interface ExtractedRecommendation {
  readonly symbol: string;
  readonly direction: RecommendationDirection;
  readonly rationale: string;
}

export interface ExtractionResult {
  /** The message with the REC line removed — what the user actually receives. */
  readonly text: string;
  readonly recommendation?: ExtractedRecommendation;
}

const DIRECTIONS = new Set<RecommendationDirection>([
  'buy',
  'sell',
  'trim',
  'add',
  'hold',
  'watch',
]);

/** `REC: NVDA | trim | up 30% since entry` */
const REC_LINE = /^\s*REC:\s*([A-Z][A-Z0-9.-]{0,9})\s*\|\s*([a-zA-Z]+)\s*\|\s*(.+?)\s*$/m;

/**
 * Pulls the structured recommendation out of an LLM message. A second parsing
 * pass in code, not a second LLM call: the format is fixed, so parsing it is
 * arithmetic, and an unparseable line simply means no recommendation was made
 * rather than a failed message.
 *
 * The line is stripped from the outgoing text — the user gets prose, the
 * database gets the structure.
 */
export function extractRecommendation(message: string): ExtractionResult {
  const match = REC_LINE.exec(message);
  if (!match) return { text: message.trim() };

  const [line, symbol, rawDirection, rationale] = match;
  const direction = rawDirection?.toLowerCase() as RecommendationDirection;
  const text = message.replace(line, '').trim();

  if (!symbol || !rationale || !DIRECTIONS.has(direction)) {
    return { text };
  }

  return { text, recommendation: { symbol, direction, rationale } };
}
