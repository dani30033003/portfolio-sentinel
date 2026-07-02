/**
 * Shared behavioral contract for every BrokerPort adapter.
 * PaperBrokerAdapter runs it now; IBKRAdapter joins in Phase 1 — that moment
 * is what validates the port abstraction (spec §1 goal 6).
 *
 * Not named *.test.ts on purpose: it only runs where a *.contract.test.ts
 * file invokes it with a concrete adapter factory.
 */
import { describe, expect, it } from 'vitest';
import type { BrokerPort } from '../../src/domain/ports/broker-port.js';
import type { Money } from '../../src/domain/entities/money.js';

function expectValidMoney(m: Money): void {
  expect(Number.isSafeInteger(m.amountCents), `amountCents must be a safe integer: ${m.amountCents}`).toBe(true);
  expect(m.currency).toMatch(/^[A-Z]{3}$/);
}

export function describeBrokerPortContract(name: string, makeBroker: () => BrokerPort): void {
  describe(`BrokerPort contract — ${name}`, () => {
    it('reports a healthy session', async () => {
      const health = await makeBroker().healthCheck();
      expect(health.ok).toBe(true);
      expect(health.detail).toBeTruthy();
    });

    it('returns at least one position, all money as integer cents', async () => {
      const positions = await makeBroker().getPositions();
      expect(positions.length).toBeGreaterThan(0);
      for (const p of positions) {
        expect(p.symbol).toBeTruthy();
        expect(p.quantity).not.toBe(0);
        expectValidMoney(p.avgCost);
        expectValidMoney(p.marketPrice);
        expectValidMoney(p.unrealizedPnl);
      }
    });

    it('reports P&L consistent with quantity × (marketPrice − avgCost)', async () => {
      const positions = await makeBroker().getPositions();
      for (const p of positions) {
        const expected = p.quantity * (p.marketPrice.amountCents - p.avgCost.amountCents);
        expect(p.unrealizedPnl.amountCents, `${p.symbol} P&L`).toBe(expected);
      }
    });

    it('returns a quote for every held symbol', async () => {
      const broker = makeBroker();
      const symbols = (await broker.getPositions()).map((p) => p.symbol);
      const quotes = await broker.getQuotes(symbols);
      expect(quotes.map((q) => q.symbol).sort()).toEqual([...symbols].sort());
      for (const q of quotes) {
        expectValidMoney(q.price);
        expect(q.asOf).toBeInstanceOf(Date);
      }
    });

    it('returns an account summary in integer cents with matching currencies', async () => {
      const account = await makeBroker().getAccountSummary();
      expectValidMoney(account.equity);
      expectValidMoney(account.cash);
      expectValidMoney(account.dayPnl);
      expect(account.cash.currency).toBe(account.equity.currency);
      expect(account.dayPnl.currency).toBe(account.equity.currency);
    });
  });
}
