/**
 * What the LLM suggested considering. Never an instruction to the system:
 * nothing downstream reads these to act. They exist so the question "does the
 * model actually add signal?" can be answered with numbers later (spec §5.5).
 */
export type RecommendationDirection = 'buy' | 'sell' | 'trim' | 'add' | 'hold' | 'watch';

export type RecommendationSource = 'summary' | 'alert' | 'chat';

export type ScoreHorizon = '1d' | '7d' | '30d';

export interface Recommendation {
  readonly madeAt: Date;
  readonly symbol: string;
  readonly direction: RecommendationDirection;
  readonly rationale: string;
  /** Price when the recommendation was made — the baseline every score uses. */
  readonly priceCents: number;
  readonly currency: string;
  readonly source: RecommendationSource;
}

export interface StoredRecommendation extends Recommendation {
  readonly id: number;
  /** Percent change since `priceCents`, per horizon; absent until scored. */
  readonly scores: Partial<Record<ScoreHorizon, number>>;
}

export const SCORE_HORIZON_DAYS: Record<ScoreHorizon, number> = {
  '1d': 1,
  '7d': 7,
  '30d': 30,
};
