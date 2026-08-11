/**
 * ═══════════════════════════ HUMAN-OWNED MODULE (written by Claude on request) ═══
 * The watchdog rules engine is a CLAUDE.md learning-protocol #3 module — normally
 * the human writes it. It was written here because the human asked for a complete
 * running POC. It is deliberately the most re-derivable file in the repo: pure
 * functions over numbers, no I/O, no clock, no LLM.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Detection is deterministic (CLAUDE.md hard rule 5). Nothing in here knows that
 * an LLM exists; the LLM is only asked to write prose *after* one of these
 * functions has already decided that something happened.
 */
import type { AccountSummary } from '../entities/account-summary.js';
import type { AlertTrigger } from '../entities/alert.js';
import { PORTFOLIO_SUBJECT } from '../entities/alert.js';
import type { Quote } from '../entities/quote.js';

/** One observed price, integer cents. History is kept oldest-first. */
export interface PricePoint {
  readonly at: Date;
  readonly priceCents: number;
}

/** A user-defined price line to watch, e.g. "tell me if NVDA goes below $1,000". */
export interface PriceLevel {
  readonly symbol: string;
  readonly priceCents: number;
  readonly direction: 'above' | 'below';
}

export interface WatchdogConfig {
  /**
   * Drop tiers in percent, ascending, e.g. [4, 7, 10]. The largest tier a move
   * clears is the one reported — that tier is also what lets a worsening move
   * break through its own cooldown (see alert-policy.ts).
   */
  readonly positionDropTiers: readonly number[];
  /** Rolling window the position drop is measured over. */
  readonly positionWindowMs: number;
  /** Same idea as positionDropTiers, applied to today's equity change. */
  readonly portfolioDropTiers: readonly number[];
  readonly levels: readonly PriceLevel[];
}

export const DEFAULT_WATCHDOG_CONFIG: WatchdogConfig = {
  positionDropTiers: [4, 7, 10],
  positionWindowMs: 30 * 60 * 1000,
  portfolioDropTiers: [2, 4, 6],
  levels: [],
};

export interface WatchdogInput {
  readonly now: Date;
  readonly quotes: readonly Quote[];
  readonly account: AccountSummary;
  /** Per symbol, oldest-first, including the current quote. */
  readonly history: ReadonlyMap<string, readonly PricePoint[]>;
  readonly config: WatchdogConfig;
}

/** Every rule, evaluated over one poll's worth of data. */
export function evaluateRules(input: WatchdogInput): AlertTrigger[] {
  return [
    ...evaluatePositionDrops(input),
    ...evaluatePortfolioDrop(input),
    ...evaluateLevelCrosses(input),
  ];
}

/**
 * Fires when a symbol is down ≥ tier% from its highest price inside the rolling
 * window. Measuring against the window *peak* rather than the window's first
 * price is what makes this a drawdown detector: a symbol that rose 5% and then
 * gave it all back has dropped 5%, even though it ends where it started.
 */
export function evaluatePositionDrops(input: WatchdogInput): AlertTrigger[] {
  const { now, config } = input;
  const windowStart = now.getTime() - config.positionWindowMs;
  const triggers: AlertTrigger[] = [];

  for (const quote of input.quotes) {
    const window = (input.history.get(quote.symbol) ?? []).filter(
      (point) => point.at.getTime() >= windowStart,
    );
    if (window.length < 2) continue;

    const peak = Math.max(...window.map((point) => point.priceCents));
    if (peak <= 0) continue;

    const changePercent = ((quote.price.amountCents - peak) / peak) * 100;
    const tier = highestTierCrossed(changePercent, config.positionDropTiers);
    if (tier === undefined) continue;

    triggers.push({
      ruleId: 'position_drop',
      subject: quote.symbol,
      changePercent,
      tierPercent: tier,
      observedAt: now,
      priceCents: quote.price.amountCents,
      referencePriceCents: peak,
    });
  }

  return triggers;
}

/**
 * Fires on today's equity change, derived from day P&L rather than from a
 * stored opening equity: equityAtOpen = equity − dayPnl. The broker already
 * computed dayPnl, so this stays correct across restarts, which a remembered
 * open would not.
 */
export function evaluatePortfolioDrop(input: WatchdogInput): AlertTrigger[] {
  const { account, config, now } = input;
  const openEquity = account.equity.amountCents - account.dayPnl.amountCents;
  if (openEquity <= 0) return [];

  const changePercent = (account.dayPnl.amountCents / openEquity) * 100;
  const tier = highestTierCrossed(changePercent, config.portfolioDropTiers);
  if (tier === undefined) return [];

  return [
    {
      ruleId: 'portfolio_drop',
      subject: PORTFOLIO_SUBJECT,
      changePercent,
      tierPercent: tier,
      observedAt: now,
      priceCents: account.equity.amountCents,
      referencePriceCents: openEquity,
    },
  ];
}

/**
 * Fires on the poll where the price moves from one side of a configured level
 * to the other. A crossing, not a state: without the previous price this would
 * re-fire on every poll for as long as the price stayed past the line.
 */
export function evaluateLevelCrosses(input: WatchdogInput): AlertTrigger[] {
  const triggers: AlertTrigger[] = [];

  for (const level of input.config.levels) {
    const quote = input.quotes.find((q) => q.symbol === level.symbol);
    if (!quote) continue;

    const history = input.history.get(level.symbol) ?? [];
    const previous = history.at(-2);
    if (!previous) continue;

    const current = quote.price.amountCents;
    const crossed =
      level.direction === 'below'
        ? previous.priceCents >= level.priceCents && current < level.priceCents
        : previous.priceCents <= level.priceCents && current > level.priceCents;
    if (!crossed) continue;

    triggers.push({
      ruleId: 'level_cross',
      subject: level.symbol,
      changePercent: ((current - level.priceCents) / level.priceCents) * 100,
      tierPercent: 0,
      observedAt: input.now,
      priceCents: current,
      referencePriceCents: level.priceCents,
    });
  }

  return triggers;
}

/**
 * The largest tier a (signed) drop clears, or undefined if it clears none.
 * Tiers are positive percentages; a −7.2% move against [4, 7, 10] returns 7.
 */
function highestTierCrossed(
  changePercent: number,
  tiers: readonly number[],
): number | undefined {
  let crossed: number | undefined;
  for (const tier of tiers) {
    if (changePercent <= -tier && (crossed === undefined || tier > crossed)) {
      crossed = tier;
    }
  }
  return crossed;
}
