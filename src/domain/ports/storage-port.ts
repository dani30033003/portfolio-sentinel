import type { AccountSummary } from '../entities/account-summary.js';
import type { Position } from '../entities/position.js';

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

/**
 * All Phase-1 persistence goes through this single port. Deliberately broad
 * for now: three tables don't justify per-consumer interfaces. The audit log
 * (Phase 3) will be a separate AuditLogPort whose interface has no update or
 * delete methods at all — the append-only rule enforced by shape, not review.
 */
export interface StoragePort {
  /** Persists account + positions in one transaction — never a torn snapshot. */
  saveSnapshot(snapshot: PortfolioSnapshot): Promise<void>;
  getLatestSnapshot(): Promise<PortfolioSnapshot | null>;
  saveSummary(summary: StoredSummary): Promise<void>;
  /** Most recent first. */
  getRecentSummaries(limit: number): Promise<StoredSummary[]>;
}
