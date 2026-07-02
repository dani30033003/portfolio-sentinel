import type { BrokerPort } from '../ports/broker-port.js';
import type { ClockPort } from '../ports/clock-port.js';
import type { LLMPort } from '../ports/llm-port.js';
import type { Position } from '../entities/position.js';
import { formatMoney, percentChange } from '../entities/money-math.js';
import { buildSummaryPrompt } from '../prompts/summary-prompt.js';
import { withTimeout } from '../util/with-timeout.js';

export interface LlmSummaryConfig {
  readonly llm: LLMPort;
  readonly timeoutMs: number;
  /** Strategy notes injected into the prompt (user_profile, Phase 3). */
  readonly userProfile?: string;
}

export interface SummaryResult {
  readonly text: string;
  /** Which path produced the text — the caller logs fallbacks. */
  readonly source: 'llm' | 'snapshot';
  /** Set when the LLM was configured but failed and we fell back. */
  readonly llmError?: string;
}

export class SummaryService {
  constructor(
    private readonly broker: BrokerPort,
    private readonly clock: ClockPort,
    /** IANA timezone for user-facing timestamps, e.g. "Asia/Jerusalem". */
    private readonly timeZone: string,
    /** Absent → summaries are always the deterministic numeric snapshot. */
    private readonly llmConfig?: LlmSummaryConfig,
  ) {}

  /**
   * The summary to send: LLM-written when configured, but never dependent on
   * it (CLAUDE.md hard rule 6) — any LLM failure or timeout falls back to the
   * numeric snapshot, which is always computed first and always sendable.
   */
  async buildSummary(): Promise<SummaryResult> {
    const snapshot = await this.buildSnapshotSummary();
    if (!this.llmConfig) {
      return { text: snapshot, source: 'snapshot' };
    }

    try {
      const prompt = buildSummaryPrompt({
        snapshot,
        ...(this.llmConfig.userProfile !== undefined
          ? { userProfile: this.llmConfig.userProfile }
          : {}),
      });
      const text = await withTimeout(
        this.llmConfig.llm.complete({
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
          maxTokens: 1024,
        }),
        this.llmConfig.timeoutMs,
        'LLM summary',
      );
      if (!text.trim()) {
        return { text: snapshot, source: 'snapshot', llmError: 'LLM returned empty text' };
      }
      return { text: text.trim(), source: 'llm' };
    } catch (error) {
      return {
        text: snapshot,
        source: 'snapshot',
        llmError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Deterministic plain-text snapshot — no LLM. Also the fallback message. */
  async buildSnapshotSummary(): Promise<string> {
    const [account, positions] = await Promise.all([
      this.broker.getAccountSummary(),
      this.broker.getPositions(),
    ]);

    const header = `Portfolio snapshot — ${formatTimestamp(this.clock.now(), this.timeZone)}`;
    const accountLine =
      `Equity ${formatMoney(account.equity)} | ` +
      `Cash ${formatMoney(account.cash)} | ` +
      `Day P&L ${formatMoney(account.dayPnl, { withSign: true })}`;

    return [header, accountLine, '', ...positions.map(positionLine)].join('\n');
  }
}

function positionLine(p: Position): string {
  const change = percentChange(p.avgCost, p.marketPrice);
  const changeText = `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
  return (
    `${p.symbol}: ${p.quantity} @ ${formatMoney(p.avgCost)} → ${formatMoney(p.marketPrice)} ` +
    `(${changeText}) P&L ${formatMoney(p.unrealizedPnl, { withSign: true })}`
  );
}

/** Timestamps are stored/computed in UTC; timezone applies only here, at the presentation edge. */
function formatTimestamp(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
