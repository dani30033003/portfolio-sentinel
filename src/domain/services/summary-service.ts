import type { BrokerPort } from '../ports/broker-port.js';
import type { ClockPort } from '../ports/clock-port.js';
import type { Position } from '../entities/position.js';
import { formatMoney, percentChange } from '../entities/money-math.js';

/**
 * Phase 0: builds a deterministic plain-text portfolio snapshot — no LLM.
 * In Phase 1 this becomes the data-gathering step that feeds LLMPort;
 * the numeric snapshot stays as the fallback when the LLM is unavailable
 * (CLAUDE.md hard rule 6: alerts/summaries must not depend on the LLM).
 */
export class SummaryService {
  constructor(
    private readonly broker: BrokerPort,
    private readonly clock: ClockPort,
    /** IANA timezone for user-facing timestamps, e.g. "Asia/Jerusalem". */
    private readonly timeZone: string,
  ) {}

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
