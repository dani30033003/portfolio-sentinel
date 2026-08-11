import type { Alert, AlertTrigger } from '../entities/alert.js';
import { PORTFOLIO_SUBJECT } from '../entities/alert.js';
import type { AccountSummary } from '../entities/account-summary.js';
import type { Position } from '../entities/position.js';
import { formatMoney } from '../entities/money-math.js';
import type { BrokerPort } from '../ports/broker-port.js';
import type { ClockPort } from '../ports/clock-port.js';
import type { MessagingPort, PhoneNumber } from '../ports/messaging-port.js';
import type { StoragePort } from '../ports/storage-port.js';
import { buildAlertPrompt } from '../prompts/alert-prompt.js';
import { withTimeout } from '../util/with-timeout.js';
import { startOfDayInZone } from '../util/time.js';
import {
  AlertPolicyState,
  DEFAULT_ALERT_POLICY_CONFIG,
  decideAlert,
  type AlertPolicyConfig,
  type PolicyDecision,
} from './alert-policy.js';
import { PriceHistory } from './price-history.js';
import type { SystemState } from './system-state.js';
import {
  DEFAULT_WATCHDOG_CONFIG,
  evaluateRules,
  type WatchdogConfig,
} from './watchdog-rules.js';
import type { LlmSummaryConfig } from './summary-service.js';

export interface WatchdogServiceConfig {
  readonly rules?: WatchdogConfig;
  readonly policy?: AlertPolicyConfig;
  readonly timeZone: string;
  /** How long the broker may look unhealthy before we say so out loud. */
  readonly gatewayDownAfterMs?: number;
}

/** What one poll did, for the composition root to log. Nothing here is thrown. */
export interface PollResult {
  readonly at: Date;
  readonly triggers: readonly AlertTrigger[];
  readonly sent: readonly Alert[];
  readonly suppressed: readonly { trigger: AlertTrigger; reason: string }[];
  readonly errors: readonly string[];
}

const DEFAULT_GATEWAY_DOWN_AFTER_MS = 10 * 60 * 1000;

/**
 * The continuous half of the system: poll prices, run the deterministic rules,
 * and message the user about what survives the alert policy.
 *
 * Alert delivery never depends on the LLM (CLAUDE.md hard rule 6). The numeric
 * text is built first and is always sendable; the LLM only ever replaces it,
 * under a timeout, and any failure falls back to the numbers.
 */
export class WatchdogService {
  private readonly rules: WatchdogConfig;
  private readonly policyConfig: AlertPolicyConfig;
  private readonly policyState = new AlertPolicyState();
  private readonly history: PriceHistory;
  private readonly gatewayDownAfterMs: number;
  /** Fallback daily counter for runs with no storage configured. */
  private alertsTodayInMemory = { day: '', count: 0 };
  private unhealthySince?: Date;
  private gatewayDownNotified = false;

  constructor(
    private readonly broker: BrokerPort,
    private readonly clock: ClockPort,
    private readonly messaging: MessagingPort,
    private readonly recipient: PhoneNumber,
    private readonly state: SystemState,
    private readonly config: WatchdogServiceConfig,
    private readonly llmConfig?: LlmSummaryConfig,
    private readonly storage?: StoragePort,
  ) {
    this.rules = config.rules ?? DEFAULT_WATCHDOG_CONFIG;
    this.policyConfig = config.policy ?? DEFAULT_ALERT_POLICY_CONFIG;
    this.gatewayDownAfterMs = config.gatewayDownAfterMs ?? DEFAULT_GATEWAY_DOWN_AFTER_MS;
    // Retain a little more than the rule window so the window is always full.
    this.history = new PriceHistory(Math.round(this.rules.positionWindowMs * 1.5));
  }

  /**
   * One cycle: observe, detect, decide, deliver. Errors are collected into the
   * result rather than thrown — a monitoring loop that dies on a transient
   * failure is worse than one that reports it and polls again.
   */
  async poll(): Promise<PollResult> {
    const at = this.clock.now();
    const errors: string[] = [];
    const sent: Alert[] = [];
    const suppressed: { trigger: AlertTrigger; reason: string }[] = [];

    const health = await this.broker.healthCheck();
    this.state.recordPoll(at, health);
    await this.reportGatewayHealth(health.ok, at, health.detail, errors);
    if (!health.ok) {
      return { at, triggers: [], sent, suppressed, errors };
    }

    const [account, positions] = await Promise.all([
      this.broker.getAccountSummary(),
      this.broker.getPositions(),
    ]);
    const quotes = await this.broker.getQuotes(positions.map((p) => p.symbol));
    for (const quote of quotes) {
      this.history.record(quote.symbol, quote.price.amountCents, at);
    }

    const triggers = evaluateRules({
      now: at,
      quotes,
      account,
      history: this.history.snapshot(),
      config: this.rules,
    });

    const alertsToday = await this.countAlertsToday(at);
    let budgetUsed = 0;

    for (const trigger of triggers) {
      const lastForKey = this.policyState.lastFor(trigger);
      const decision: PolicyDecision = decideAlert({
        trigger,
        now: at,
        ...(lastForKey ? { lastForKey } : {}),
        // Triggers inside one poll must consume the same budget, or a single
        // poll producing 20 triggers would send all 20 against a cap of 10.
        alertsToday: alertsToday + budgetUsed,
        paused: this.state.paused,
        config: this.policyConfig,
      });

      if (!decision.send) {
        suppressed.push({ trigger, reason: decision.reason });
        continue;
      }

      try {
        const alert = await this.deliver(trigger, positions, account, at);
        sent.push(alert);
        budgetUsed += 1;
        if (!this.storage) this.alertsTodayInMemory.count += 1;
        this.policyState.record(trigger, at);
        this.state.recordAlert(at);
      } catch (error) {
        errors.push(describe(error));
      }
    }

    return { at, triggers, sent, suppressed, errors };
  }

  /** Builds the text (numeric, then LLM if it can), sends it, then persists it. */
  private async deliver(
    trigger: AlertTrigger,
    positions: readonly Position[],
    account: AccountSummary,
    at: Date,
  ): Promise<Alert> {
    const numericText = renderNumericAlert(trigger, positions, account);
    const written = await this.writeAlertText(numericText, trigger, positions);

    await this.messaging.sendMessage(this.recipient, written.text);

    const alert: Alert = {
      firedAt: at,
      ruleId: trigger.ruleId,
      subject: trigger.subject,
      changePercent: trigger.changePercent,
      tierPercent: trigger.tierPercent,
      text: written.text,
      source: written.source,
    };
    // Persist after sending: the cap counts what the user actually received,
    // and a storage failure must not stop an alert that already went out.
    await this.storage?.saveAlert(alert).catch(() => undefined);
    return alert;
  }

  private async writeAlertText(
    numericText: string,
    trigger: AlertTrigger,
    positions: readonly Position[],
  ): Promise<{ text: string; source: Alert['source'] }> {
    if (!this.llmConfig) return { text: numericText, source: 'numeric' };

    try {
      const prompt = buildAlertPrompt({
        numericAlert: numericText,
        exposure: renderExposure(trigger, positions),
        ...(this.llmConfig.userProfile !== undefined
          ? { userProfile: this.llmConfig.userProfile }
          : {}),
      });
      const text = await withTimeout(
        this.llmConfig.llm.complete({
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
          maxTokens: 400,
        }),
        this.llmConfig.timeoutMs,
        'LLM alert',
      );
      return text.trim()
        ? { text: text.trim(), source: 'llm' }
        : { text: numericText, source: 'numeric' };
    } catch {
      return { text: numericText, source: 'numeric' };
    }
  }

  /**
   * Silent failure is the worst failure mode for a monitoring tool (spec §8):
   * if the broker session stays down, say so once, and say so again when it
   * comes back. Announced only after gatewayDownAfterMs so a single failed
   * poll doesn't page anyone.
   */
  private async reportGatewayHealth(
    ok: boolean,
    at: Date,
    detail: string,
    errors: string[],
  ): Promise<void> {
    if (ok) {
      if (this.gatewayDownNotified) {
        await this.notify(`Broker connection is back. ${detail}`, errors);
      }
      this.unhealthySince = undefined;
      this.gatewayDownNotified = false;
      return;
    }

    this.unhealthySince ??= at;
    const downForMs = at.getTime() - this.unhealthySince.getTime();
    if (!this.gatewayDownNotified && downForMs >= this.gatewayDownAfterMs) {
      this.gatewayDownNotified = true;
      await this.notify(
        `I am blind: the broker connection has been down for ${Math.round(downForMs / 60000)} ` +
          `minutes. No alerts can fire until it is back. (${detail})`,
        errors,
      );
    }
  }

  private async notify(text: string, errors: string[]): Promise<void> {
    try {
      await this.messaging.sendMessage(this.recipient, text);
    } catch (error) {
      errors.push(describe(error));
    }
  }

  /**
   * From storage when available, so a restart cannot reset the cap; from an
   * in-process counter otherwise (dry runs and tests).
   */
  private async countAlertsToday(at: Date): Promise<number> {
    const dayStart = startOfDayInZone(at, this.config.timeZone);
    if (this.storage) {
      try {
        return await this.storage.countAlertsSince(dayStart);
      } catch {
        // Storage is unavailable; fall through to the in-memory counter rather
        // than treating "unknown" as "zero alerts sent today".
      }
    }
    const day = dayStart.toISOString();
    if (this.alertsTodayInMemory.day !== day) {
      this.alertsTodayInMemory = { day, count: 0 };
    }
    return this.alertsTodayInMemory.count;
  }
}

/**
 * The alert that always works: pure formatting over numbers the rules already
 * produced. This is what the user receives when the LLM is absent, slow, or
 * broken — so it has to be readable on its own, not a placeholder.
 */
export function renderNumericAlert(
  trigger: AlertTrigger,
  positions: readonly Position[],
  account: AccountSummary,
): string {
  const move = `${trigger.changePercent >= 0 ? '+' : ''}${trigger.changePercent.toFixed(1)}%`;
  const currency = account.equity.currency;
  const price = (cents: number) => formatMoney({ amountCents: cents, currency });

  switch (trigger.ruleId) {
    case 'position_drop': {
      const position = positions.find((p) => p.symbol === trigger.subject);
      const exposure = position
        ? ` Position: ${position.quantity} shares, P&L ` +
          `${formatMoney(position.unrealizedPnl, { withSign: true })}.`
        : '';
      return (
        `ALERT ${trigger.subject} ${move} from its recent high: ` +
        `${price(trigger.referencePriceCents)} to ${price(trigger.priceCents)}.${exposure}`
      );
    }
    case 'portfolio_drop':
      return (
        `ALERT portfolio ${move} today: equity ${price(trigger.priceCents)}, ` +
        `day P&L ${formatMoney(account.dayPnl, { withSign: true })}.`
      );
    case 'level_cross': {
      const direction = trigger.priceCents < trigger.referencePriceCents ? 'below' : 'above';
      return (
        `ALERT ${trigger.subject} crossed ${direction} ` +
        `${price(trigger.referencePriceCents)}: now ${price(trigger.priceCents)}.`
      );
    }
  }
}

/** The context line the LLM gets so it can size the move against the position. */
function renderExposure(trigger: AlertTrigger, positions: readonly Position[]): string {
  if (trigger.subject === PORTFOLIO_SUBJECT) {
    return positions
      .map(
        (p) =>
          `${p.symbol}: ${p.quantity} @ ${formatMoney(p.marketPrice)} ` +
          `(P&L ${formatMoney(p.unrealizedPnl, { withSign: true })})`,
      )
      .join('\n');
  }

  const position = positions.find((p) => p.symbol === trigger.subject);
  if (!position) return `No open position in ${trigger.subject}.`;
  return (
    `${position.symbol}: ${position.quantity} shares at ${formatMoney(position.marketPrice)}, ` +
    `average cost ${formatMoney(position.avgCost)}, ` +
    `unrealized P&L ${formatMoney(position.unrealizedPnl, { withSign: true })}`
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
