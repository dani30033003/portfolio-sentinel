import type { PricePoint } from './watchdog-rules.js';

/**
 * The rolling price window the watchdog rules read. In memory on purpose: it
 * is derived data (every point came from a poll seconds ago), it must be fast
 * to read on every poll, and losing it on restart costs only the first window
 * of alert coverage. Storage keeps the snapshots that matter historically.
 */
export class PriceHistory {
  private readonly points = new Map<string, PricePoint[]>();

  /** @param retentionMs how far back to keep points; older ones are dropped. */
  constructor(private readonly retentionMs: number) {}

  record(symbol: string, priceCents: number, at: Date): void {
    const series = this.points.get(symbol) ?? [];
    series.push({ at, priceCents });

    // Trim from the front: the series is append-only in time order, so the
    // expired points are always a prefix. Without this the map grows for as
    // long as the process runs.
    const cutoff = at.getTime() - this.retentionMs;
    let firstLive = 0;
    while (firstLive < series.length && (series[firstLive] as PricePoint).at.getTime() < cutoff) {
      firstLive += 1;
    }
    this.points.set(symbol, firstLive > 0 ? series.slice(firstLive) : series);
  }

  /** Oldest-first, exactly what evaluateRules expects. */
  snapshot(): ReadonlyMap<string, readonly PricePoint[]> {
    return this.points;
  }
}
