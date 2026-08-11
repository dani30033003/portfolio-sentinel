import type { ClockPort } from '../ports/clock-port.js';
import type { StoragePort } from '../ports/storage-port.js';
import type {
  RecommendationDirection,
  StoredRecommendation,
} from '../entities/recommendation.js';
import { formatDuration, formatInZone } from '../util/time.js';
import type { SystemState } from './system-state.js';

/**
 * Answers STATUS and STATS. Deliberately LLM-free: when the user asks whether
 * the system is alive, the answer must not depend on a service that might be
 * the thing that is down.
 */
export class StatusService {
  constructor(
    private readonly clock: ClockPort,
    private readonly state: SystemState,
    private readonly timeZone: string,
    private readonly storage?: StoragePort,
  ) {}

  async renderStatus(): Promise<string> {
    const now = this.clock.now();
    const health = this.state.brokerHealth;
    const lines = [
      `Portfolio Sentinel — ${this.state.paused ? 'PAUSED' : 'active'}`,
      `Uptime: ${formatDuration(now.getTime() - this.state.startedAt.getTime())}`,
      `Broker: ${health.ok ? 'connected' : 'DOWN'} (${health.detail})`,
      `Last poll: ${this.since(now, this.state.lastPollAt)}`,
      `Last summary: ${this.since(now, this.state.lastSummaryAt)}`,
      `Last alert: ${this.since(now, this.state.lastAlertAt)}`,
    ];

    if (this.storage) {
      try {
        const stats = await this.storage.getStats();
        lines.push(
          `Stored: ${stats.snapshotCount} snapshots, ${stats.summaryCount} summaries, ` +
            `${stats.alertCount} alerts (${Math.round(stats.sizeBytes / 1024)} KB)`,
        );
      } catch (error) {
        lines.push(`Storage: unavailable (${describe(error)})`);
      }
    } else {
      lines.push('Storage: not configured (nothing is being persisted)');
    }

    lines.push(`Server time: ${formatInZone(now, this.timeZone)}`);
    return lines.join('\n');
  }

  /**
   * STATS answers "does the model add signal?" — hit rate is the share of
   * scored recommendations where the price moved the way the model suggested.
   * No opinion, no LLM: just the arithmetic, including when it is unflattering.
   */
  async renderStats(): Promise<string> {
    if (!this.storage) return 'No storage configured, so no recommendations are tracked.';

    const recommendations = await this.storage.getRecentRecommendations(200);
    if (recommendations.length === 0) {
      return 'No recommendations recorded yet.';
    }

    const lines = [`Recommendations recorded: ${recommendations.length}`];
    for (const horizon of ['1d', '7d', '30d'] as const) {
      // Directionless suggestions (hold, watch) are excluded from the sample
      // entirely rather than counted as misses — they made no claim to test.
      const scored = recommendations.filter(
        (r) => r.scores[horizon] !== undefined && hasDirection(r.direction),
      );
      if (scored.length === 0) {
        lines.push(`${horizon}: not scored yet`);
        continue;
      }
      const hits = scored.filter((r) => isHit(r, r.scores[horizon] as number)).length;
      const averageMove =
        scored.reduce((total, r) => total + (r.scores[horizon] as number), 0) / scored.length;
      lines.push(
        `${horizon}: ${hits}/${scored.length} went the suggested way ` +
          `(${Math.round((hits / scored.length) * 100)}%), average move ` +
          `${averageMove >= 0 ? '+' : ''}${averageMove.toFixed(1)}%`,
      );
    }

    lines.push('These are measurements, not proof of skill. Small samples say little.');
    return lines.join('\n');
  }

  private since(now: Date, at?: Date): string {
    if (!at) return 'never';
    return `${formatInZone(at, this.timeZone)} (${formatDuration(now.getTime() - at.getTime())} ago)`;
  }
}

/** A "hit" is the price moving the way the recommendation pointed. */
function isHit(recommendation: StoredRecommendation, changePercent: number): boolean {
  return recommendation.direction === 'buy' || recommendation.direction === 'add'
    ? changePercent > 0
    : changePercent < 0;
}

function hasDirection(direction: RecommendationDirection): boolean {
  return direction !== 'hold' && direction !== 'watch';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
