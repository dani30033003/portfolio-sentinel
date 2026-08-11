import type { Position } from '../entities/position.js';
import type { RecommendationSource, ScoreHorizon } from '../entities/recommendation.js';
import type { BrokerPort } from '../ports/broker-port.js';
import type { StoragePort } from '../ports/storage-port.js';
import type { ExtractedRecommendation } from './recommendation-extractor.js';

const HORIZONS: readonly ScoreHorizon[] = ['1d', '7d', '30d'];

export interface ScoringResult {
  readonly scored: number;
  readonly errors: readonly string[];
}

/**
 * Keeps the honesty ledger (spec §5.5): what the model suggested, at what
 * price, and what happened next. Nothing in the system reads these to act —
 * they exist so "is this thing any good?" has a numeric answer.
 */
export class RecommendationTracker {
  constructor(private readonly storage?: StoragePort) {}

  /**
   * Stores an extracted recommendation against the price at the moment it was
   * made. Best-effort: a tracking failure must never cost the user the message
   * the recommendation came in.
   */
  async record(
    recommendation: ExtractedRecommendation,
    positions: readonly Position[],
    at: Date,
    source: RecommendationSource,
  ): Promise<void> {
    if (!this.storage) return;

    // Without a price there is no baseline, so the recommendation could never
    // be scored — better not to record it than to record something unfalsifiable.
    const position = positions.find((p) => p.symbol === recommendation.symbol);
    if (!position) return;

    try {
      await this.storage.saveRecommendation({
        madeAt: at,
        symbol: recommendation.symbol,
        direction: recommendation.direction,
        rationale: recommendation.rationale,
        priceCents: position.marketPrice.amountCents,
        currency: position.marketPrice.currency,
        source,
      });
    } catch {
      // ignored on purpose — see method comment
    }
  }

  /**
   * The nightly job: for every recommendation old enough for a horizon and not
   * yet scored at it, record the percent move since it was made. Measurement
   * only — nothing acts on the result.
   */
  async scoreDue(broker: BrokerPort, now: Date): Promise<ScoringResult> {
    if (!this.storage) return { scored: 0, errors: [] };

    const errors: string[] = [];
    let scored = 0;

    for (const horizon of HORIZONS) {
      let due;
      try {
        due = await this.storage.getRecommendationsDueForScoring(horizon, now);
      } catch (error) {
        errors.push(describe(error));
        continue;
      }
      if (due.length === 0) continue;

      const symbols = [...new Set(due.map((r) => r.symbol))];
      let prices: Map<string, number>;
      try {
        const quotes = await broker.getQuotes(symbols);
        prices = new Map(quotes.map((q) => [q.symbol, q.price.amountCents]));
      } catch (error) {
        errors.push(describe(error));
        continue;
      }

      for (const recommendation of due) {
        const price = prices.get(recommendation.symbol);
        // No current price (position closed, symbol delisted): leave it
        // unscored so a later run can try again, rather than writing a zero.
        if (price === undefined || recommendation.priceCents === 0) continue;

        const changePercent =
          ((price - recommendation.priceCents) / recommendation.priceCents) * 100;
        try {
          await this.storage.recordRecommendationScore(recommendation.id, horizon, changePercent);
          scored += 1;
        } catch (error) {
          errors.push(describe(error));
        }
      }
    }

    return { scored, errors };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
