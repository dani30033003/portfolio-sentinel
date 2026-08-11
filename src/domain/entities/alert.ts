/** Which watchdog rule fired. Detection is pure math — see watchdog-rules.ts. */
export type AlertRuleId = 'position_drop' | 'portfolio_drop' | 'level_cross';

/** Cooldown key for account-wide rules, which have no symbol of their own. */
export const PORTFOLIO_SUBJECT = 'PORTFOLIO';

/**
 * A rule crossing produced by the rules engine. Pure data: no text, no
 * decision about whether it will actually be sent — that is the alert
 * policy's call, and the wording is the presentation layer's.
 */
export interface AlertTrigger {
  readonly ruleId: AlertRuleId;
  /** Symbol, or PORTFOLIO_SUBJECT. Together with ruleId this keys cooldowns. */
  readonly subject: string;
  /** Signed percent move that fired the rule, e.g. -4.7. */
  readonly changePercent: number;
  /** The configured tier that was crossed, e.g. 4 for the 4% tier. */
  readonly tierPercent: number;
  readonly observedAt: Date;
  /** Price in integer cents at the moment of the trigger (0 for portfolio rules). */
  readonly priceCents: number;
  /** The reference price the change was measured against, integer cents. */
  readonly referencePriceCents: number;
}

/** A trigger that survived the policy and was delivered. */
export interface Alert {
  readonly firedAt: Date;
  readonly ruleId: AlertRuleId;
  readonly subject: string;
  readonly changePercent: number;
  readonly tierPercent: number;
  /** The message text actually sent. */
  readonly text: string;
  /** Whether the LLM wrote it, or the deterministic numeric fallback did. */
  readonly source: 'llm' | 'numeric';
}
