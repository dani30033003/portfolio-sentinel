import type { Position } from '../entities/position.js';
import { formatMoney, percentChange } from '../entities/money-math.js';
import type { PortfolioSnapshot } from '../ports/storage-port.js';
import { formatInZone } from '../util/time.js';

/**
 * The one rendering of a portfolio snapshot, shared by every path that shows
 * one: the summary, its LLM prompt, the chat prompt, and the fallback message.
 * Pure formatting — no I/O, no clock. Keeping it in one place is what makes
 * "the fallback looks like the real thing" true by construction.
 */
export function renderSnapshot(snapshot: PortfolioSnapshot, timeZone: string): string {
  const { account } = snapshot;
  const header = `Portfolio snapshot — ${formatInZone(snapshot.takenAt, timeZone)}`;
  const accountLine =
    `Equity ${formatMoney(account.equity)} | ` +
    `Cash ${formatMoney(account.cash)} | ` +
    `Day P&L ${formatMoney(account.dayPnl, { withSign: true })}`;

  return [header, accountLine, '', ...snapshot.positions.map(positionLine)].join('\n');
}

export function positionLine(p: Position): string {
  const change = percentChange(p.avgCost, p.marketPrice);
  const changeText = `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
  return (
    `${p.symbol}: ${p.quantity} @ ${formatMoney(p.avgCost)} → ${formatMoney(p.marketPrice)} ` +
    `(${changeText}) P&L ${formatMoney(p.unrealizedPnl, { withSign: true })}`
  );
}
