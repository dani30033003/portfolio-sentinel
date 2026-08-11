import { describe, expect, it } from 'vitest';
import type { AlertTrigger } from '../../src/domain/entities/alert.js';
import {
  AlertPolicyState,
  DEFAULT_ALERT_POLICY_CONFIG,
  alertKey,
  decideAlert,
  type PolicyInput,
} from '../../src/domain/services/alert-policy.js';

const NOW = new Date('2026-07-06T14:00:00.000Z');

const trigger = (overrides: Partial<AlertTrigger> = {}): AlertTrigger => ({
  ruleId: 'position_drop',
  subject: 'NVDA',
  changePercent: -4.5,
  tierPercent: 4,
  observedAt: NOW,
  priceCents: 95_000,
  referencePriceCents: 100_000,
  ...overrides,
});

const decide = (overrides: Partial<PolicyInput> = {}) =>
  decideAlert({
    trigger: trigger(),
    now: NOW,
    alertsToday: 0,
    paused: false,
    config: DEFAULT_ALERT_POLICY_CONFIG,
    ...overrides,
  });

describe('decideAlert', () => {
  it('sends a first-time trigger', () => {
    expect(decide()).toEqual({ send: true });
  });

  it('stays silent while paused, even for a fresh trigger', () => {
    expect(decide({ paused: true })).toEqual({ send: false, reason: 'paused' });
  });

  it('stops at the daily cap', () => {
    expect(decide({ alertsToday: 10 })).toEqual({ send: false, reason: 'daily_cap' });
    expect(decide({ alertsToday: 9 })).toEqual({ send: true });
  });

  it('suppresses a repeat of the same tier inside the cooldown', () => {
    const decision = decide({
      lastForKey: { firedAt: new Date(NOW.getTime() - 30 * 60_000), tierPercent: 4 },
    });
    expect(decision).toEqual({ send: false, reason: 'cooldown' });
  });

  it('lets a higher tier break through the cooldown', () => {
    const decision = decide({
      trigger: trigger({ tierPercent: 10, changePercent: -11 }),
      lastForKey: { firedAt: new Date(NOW.getTime() - 30 * 60_000), tierPercent: 4 },
    });
    expect(decision).toEqual({ send: true });
  });

  it('sends again once the cooldown has expired', () => {
    const decision = decide({
      lastForKey: { firedAt: new Date(NOW.getTime() - 3 * 60 * 60_000), tierPercent: 4 },
    });
    expect(decision).toEqual({ send: true });
  });

  it('checks the kill switch before the cap, so PAUSE is never masked', () => {
    const decision = decide({ paused: true, alertsToday: 99 });
    expect(decision).toEqual({ send: false, reason: 'paused' });
  });
});

describe('AlertPolicyState', () => {
  it('keys cooldowns by rule and subject together', () => {
    const state = new AlertPolicyState();
    state.record(trigger(), NOW);

    expect(state.lastFor(trigger())).toEqual({ firedAt: NOW, tierPercent: 4 });
    expect(state.lastFor(trigger({ subject: 'AAPL' }))).toBeUndefined();
    expect(state.lastFor(trigger({ ruleId: 'level_cross' }))).toBeUndefined();
  });

  it('exposes a stable key format', () => {
    expect(alertKey(trigger())).toBe('position_drop:NVDA');
  });
});
