import type { Alert } from '../../src/domain/entities/alert.js';
import type {
  Recommendation,
  ScoreHorizon,
  StoredRecommendation,
} from '../../src/domain/entities/recommendation.js';
import { SCORE_HORIZON_DAYS } from '../../src/domain/entities/recommendation.js';
import type {
  ConversationTurn,
  PortfolioSnapshot,
  StoragePort,
  StorageStats,
  StoredSummary,
} from '../../src/domain/ports/storage-port.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * In-memory StoragePort for tests that need persistence to work without a
 * database. Behavior (ordering, filtering) must match SqliteStorageAdapter —
 * where it can't, the test belongs against the real adapter instead.
 */
export class FakeStorage implements StoragePort {
  readonly snapshots: PortfolioSnapshot[] = [];
  readonly summaries: StoredSummary[] = [];
  readonly alerts: Alert[] = [];
  readonly conversation: ConversationTurn[] = [];
  readonly recommendations: StoredRecommendation[] = [];

  saveSnapshot(snapshot: PortfolioSnapshot): Promise<void> {
    this.snapshots.push(snapshot);
    return Promise.resolve();
  }

  getLatestSnapshot(): Promise<PortfolioSnapshot | null> {
    return Promise.resolve(this.snapshots.at(-1) ?? null);
  }

  saveSummary(summary: StoredSummary): Promise<void> {
    this.summaries.push(summary);
    return Promise.resolve();
  }

  getRecentSummaries(limit: number): Promise<StoredSummary[]> {
    return Promise.resolve(this.summaries.slice(-limit).reverse());
  }

  saveAlert(alert: Alert): Promise<void> {
    this.alerts.push(alert);
    return Promise.resolve();
  }

  getRecentAlerts(limit: number): Promise<Alert[]> {
    return Promise.resolve(this.alerts.slice(-limit).reverse());
  }

  countAlertsSince(since: Date): Promise<number> {
    return Promise.resolve(this.alerts.filter((a) => a.firedAt >= since).length);
  }

  appendConversationTurn(turn: ConversationTurn): Promise<void> {
    this.conversation.push(turn);
    return Promise.resolve();
  }

  getRecentConversation(limit: number): Promise<ConversationTurn[]> {
    return Promise.resolve(this.conversation.slice(-limit));
  }

  saveRecommendation(recommendation: Recommendation): Promise<number> {
    const id = this.recommendations.length + 1;
    this.recommendations.push({ ...recommendation, id, scores: {} });
    return Promise.resolve(id);
  }

  getRecentRecommendations(limit: number): Promise<StoredRecommendation[]> {
    return Promise.resolve(this.recommendations.slice(-limit).reverse());
  }

  getRecommendationsDueForScoring(
    horizon: ScoreHorizon,
    asOf: Date,
  ): Promise<StoredRecommendation[]> {
    const cutoff = asOf.getTime() - SCORE_HORIZON_DAYS[horizon] * DAY_MS;
    return Promise.resolve(
      this.recommendations.filter(
        (r) => r.scores[horizon] === undefined && r.madeAt.getTime() <= cutoff,
      ),
    );
  }

  recordRecommendationScore(
    id: number,
    horizon: ScoreHorizon,
    changePercent: number,
  ): Promise<void> {
    const index = this.recommendations.findIndex((r) => r.id === id);
    const existing = this.recommendations[index];
    if (existing) {
      this.recommendations[index] = {
        ...existing,
        scores: { ...existing.scores, [horizon]: changePercent },
      };
    }
    return Promise.resolve();
  }

  getStats(): Promise<StorageStats> {
    return Promise.resolve({
      snapshotCount: this.snapshots.length,
      summaryCount: this.summaries.length,
      alertCount: this.alerts.length,
      recommendationCount: this.recommendations.length,
      sizeBytes: 0,
    });
  }
}
