/**
 * Alert hygiene: whether a trigger that really happened should actually reach the
 * phone. Kept separate from watchdog-rules.ts because these are different
 * questions — "did the market move?" versus "have I already said so?" — and
 * mixing them makes both harder to test.
 */
import type { AlertTrigger } from '../entities/alert.js';

export interface AlertPolicyConfig {
  /** Per (rule, subject) silence window after an alert. */
  readonly cooldownMs: number;
  /** Hard ceiling on alerts per calendar day, all rules combined. */
  readonly dailyCap: number;
}

export const DEFAULT_ALERT_POLICY_CONFIG: AlertPolicyConfig = {
  cooldownMs: 2 * 60 * 60 * 1000,
  dailyCap: 10,
};

/** What was sent last for one (rule, subject) key. */
export interface LastAlertRecord {
  readonly firedAt: Date;
  readonly tierPercent: number;
}

export type PolicyDecision =
  | { readonly send: true }
  | { readonly send: false; readonly reason: 'paused' | 'cooldown' | 'daily_cap' };

export interface PolicyInput {
  readonly trigger: AlertTrigger;
  readonly now: Date;
  readonly lastForKey?: LastAlertRecord;
  readonly alertsToday: number;
  readonly paused: boolean;
  readonly config: AlertPolicyConfig;
}

/** Cooldowns are per rule *and* per subject: NVDA dropping doesn't mute AAPL. */
export function alertKey(trigger: AlertTrigger): string {
  return `${trigger.ruleId}:${trigger.subject}`;
}

/**
 * Pure decision, in priority order:
 *  1. PAUSE means silence — the user's kill switch outranks everything.
 *  2. The daily cap is a circuit breaker against an alert storm.
 *  3. Cooldown, unless the move has crossed a strictly higher tier than the
 *     alert that started the cooldown. That exception is the point of tiers: a
 *     symbol that was −4% when we messaged and is now −10% is news again, while
 *     one still hovering at −4% is not.
 */
export function decideAlert(input: PolicyInput): PolicyDecision {
  if (input.paused) return { send: false, reason: 'paused' };
  if (input.alertsToday >= input.config.dailyCap) {
    return { send: false, reason: 'daily_cap' };
  }

  const last = input.lastForKey;
  if (last) {
    const elapsed = input.now.getTime() - last.firedAt.getTime();
    const withinCooldown = elapsed < input.config.cooldownMs;
    const escalated = input.trigger.tierPercent > last.tierPercent;
    if (withinCooldown && !escalated) return { send: false, reason: 'cooldown' };
  }

  return { send: true };
}

/**
 * The cooldown state, kept in memory. Deliberately not a database concern: it
 * is a few dozen bytes that only matter while the process is alive, and a
 * restart erring toward one extra alert is the harmless direction. The daily
 * cap is the opposite — it is counted from storage, so a restart loop cannot
 * be used to bypass it.
 */
export class AlertPolicyState {
  private readonly lastByKey = new Map<string, LastAlertRecord>();

  lastFor(trigger: AlertTrigger): LastAlertRecord | undefined {
    return this.lastByKey.get(alertKey(trigger));
  }

  record(trigger: AlertTrigger, firedAt: Date): void {
    this.lastByKey.set(alertKey(trigger), { firedAt, tierPercent: trigger.tierPercent });
  }
}
