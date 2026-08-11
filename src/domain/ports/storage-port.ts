import type { AccountSummary } from '../entities/account-summary.js';
import type { Alert } from '../entities/alert.js';
import type { Position } from '../entities/position.js';
import type {
  Recommendation,
  ScoreHorizon,
  StoredRecommendation,
} from '../entities/recommendation.js';

/**
 * Why a summary was produced. Alerts are NOT a summary kind — they get their
 * own table (and port methods) in Phase 2, because they carry rule/threshold
 * data that summaries don't have.
 */
export type SummaryKind = 'scheduled' | 'on_demand';

/** One point-in-time capture of the whole portfolio, saved atomically. */
export interface PortfolioSnapshot {
  /** When the snapshot was taken (UTC — the adapter persists ISO 8601). */
  readonly takenAt: Date;
  readonly account: AccountSummary;
  readonly positions: readonly Position[];
}

export interface StoredSummary {
  readonly sentAt: Date;
  readonly kind: SummaryKind;
  readonly text: string;
  /**
   * The positions the summary was written about, if captured — lets a later
   * phase answer "what did you recommend and what happened since?" without
   * joining back to snapshot tables.
   */
  readonly positionsJson?: string;
}

/** One turn of the WhatsApp/console conversation, for chat context. */
export interface ConversationTurn {
  readonly at: Date;
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

/** Counters behind the STATUS command. Cheap to compute, no domain meaning. */
export interface StorageStats {
  readonly snapshotCount: number;
  readonly summaryCount: number;
  readonly alertCount: number;
  readonly recommendationCount: number;
  readonly sizeBytes: number;
}

/**
 * All persistence goes through this single port. Deliberately broad: a handful
 * of tables don't justify per-consumer interfaces. The audit log (Phase 4)
 * will be a separate AuditLogPort whose interface has no update or delete
 * methods at all — the append-only rule enforced by shape, not review.
 */
export interface StoragePort {
  /** Persists account + positions in one transaction — never a torn snapshot. */
  saveSnapshot(snapshot: PortfolioSnapshot): Promise<void>;
  getLatestSnapshot(): Promise<PortfolioSnapshot | null>;
  saveSummary(summary: StoredSummary): Promise<void>;
  /** Most recent first. */
  getRecentSummaries(limit: number): Promise<StoredSummary[]>;

  saveAlert(alert: Alert): Promise<void>;
  /** Most recent first. */
  getRecentAlerts(limit: number): Promise<Alert[]>;
  /** Backs the daily alert cap, which must survive a restart. */
  countAlertsSince(since: Date): Promise<number>;

  appendConversationTurn(turn: ConversationTurn): Promise<void>;
  /** Oldest first — the order an LLM expects a transcript in. */
  getRecentConversation(limit: number): Promise<ConversationTurn[]>;

  saveRecommendation(recommendation: Recommendation): Promise<number>;
  /** Most recent first. */
  getRecentRecommendations(limit: number): Promise<StoredRecommendation[]>;
  /**
   * Recommendations old enough for `horizon` that have not been scored at it
   * yet — the work list for the scoring job.
   */
  getRecommendationsDueForScoring(
    horizon: ScoreHorizon,
    asOf: Date,
  ): Promise<StoredRecommendation[]>;
  /**
   * Writes one horizon's score. This is an UPDATE, which is fine here — the
   * no-UPDATE rule covers `audit_log` only, and a score is a measurement of a
   * row, not a rewrite of what was recommended.
   */
  recordRecommendationScore(
    id: number,
    horizon: ScoreHorizon,
    changePercent: number,
  ): Promise<void>;

  getStats(): Promise<StorageStats>;
}
