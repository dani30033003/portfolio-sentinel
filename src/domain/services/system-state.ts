import type { HealthStatus } from '../entities/health.js';

/**
 * Everything STATUS reports and PAUSE toggles: the process's own view of
 * itself. In memory by design — a restart genuinely has not polled yet, so
 * remembering the previous process's last poll time would be a lie.
 *
 * The one exception is the daily alert cap, which is counted from storage
 * precisely because a restart must not reset it.
 */
export class SystemState {
  private pausedFlag = false;
  private lastPoll?: Date;
  private lastSummary?: Date;
  private lastAlert?: Date;
  private health: HealthStatus = { ok: false, detail: 'not polled yet' };

  constructor(readonly startedAt: Date) {}

  get paused(): boolean {
    return this.pausedFlag;
  }

  /** @returns true if this call changed the state. */
  setPaused(paused: boolean): boolean {
    const changed = this.pausedFlag !== paused;
    this.pausedFlag = paused;
    return changed;
  }

  recordPoll(at: Date, health: HealthStatus): void {
    this.lastPoll = at;
    this.health = health;
  }

  recordSummary(at: Date): void {
    this.lastSummary = at;
  }

  recordAlert(at: Date): void {
    this.lastAlert = at;
  }

  get lastPollAt(): Date | undefined {
    return this.lastPoll;
  }

  get lastSummaryAt(): Date | undefined {
    return this.lastSummary;
  }

  get lastAlertAt(): Date | undefined {
    return this.lastAlert;
  }

  get brokerHealth(): HealthStatus {
    return this.health;
  }
}
