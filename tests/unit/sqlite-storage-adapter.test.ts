import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteStorageAdapter } from '../../src/adapters/storage-sqlite/sqlite-storage-adapter.js';
import type { PortfolioSnapshot } from '../../src/domain/ports/storage-port.js';
import { StorageError } from '../../src/domain/errors.js';

const usd = (amountCents: number) => ({ amountCents, currency: 'USD' });

const snapshotAt = (iso: string, equityCents = 10000000): PortfolioSnapshot => ({
  takenAt: new Date(iso),
  account: { equity: usd(equityCents), cash: usd(2500000), dayPnl: usd(-34500) },
  positions: [
    {
      symbol: 'MSFT',
      quantity: 5,
      avgCost: usd(40000),
      marketPrice: usd(38000),
      unrealizedPnl: usd(-10000),
    },
    {
      symbol: 'AAPL',
      quantity: 10.5, // fractional shares must survive the round trip
      avgCost: usd(15000),
      marketPrice: usd(19530),
      unrealizedPnl: usd(47565),
    },
  ],
});

describe('SqliteStorageAdapter', () => {
  let storage: SqliteStorageAdapter;

  beforeEach(() => {
    storage = new SqliteStorageAdapter(':memory:');
  });

  afterEach(() => {
    storage.close();
  });

  describe('snapshots', () => {
    it('returns null when nothing has been saved', async () => {
      expect(await storage.getLatestSnapshot()).toBeNull();
    });

    it('round-trips a snapshot exactly, positions sorted by symbol', async () => {
      const snapshot = snapshotAt('2026-07-06T09:00:00.000Z');
      await storage.saveSnapshot(snapshot);

      const loaded = await storage.getLatestSnapshot();
      expect(loaded).not.toBeNull();
      expect(loaded?.takenAt).toEqual(snapshot.takenAt);
      expect(loaded?.account).toEqual(snapshot.account);
      // Saved MSFT-first; read back alphabetical.
      expect(loaded?.positions.map((p) => p.symbol)).toEqual(['AAPL', 'MSFT']);
      expect(loaded?.positions[0]).toEqual(snapshot.positions[1]);
    });

    it('preserves integer cents exactly at large magnitudes', async () => {
      // Above 2^32 — would corrupt if anything narrowed to 32-bit on the way through.
      const snapshot = snapshotAt('2026-07-06T09:00:00.000Z', 4_300_000_000_01);
      await storage.saveSnapshot(snapshot);
      const loaded = await storage.getLatestSnapshot();
      expect(loaded?.account.equity.amountCents).toBe(4_300_000_000_01);
    });

    it('returns the newest snapshot by timestamp, not insertion order', async () => {
      await storage.saveSnapshot(snapshotAt('2026-07-06T14:00:00.000Z', 1));
      await storage.saveSnapshot(snapshotAt('2026-07-06T09:00:00.000Z', 2)); // older, inserted later

      const loaded = await storage.getLatestSnapshot();
      expect(loaded?.takenAt.toISOString()).toBe('2026-07-06T14:00:00.000Z');
      expect(loaded?.account.equity.amountCents).toBe(1);
    });

    it('keeps positions attached to their own snapshot', async () => {
      await storage.saveSnapshot(snapshotAt('2026-07-06T09:00:00.000Z'));
      await storage.saveSnapshot({
        takenAt: new Date('2026-07-06T14:00:00.000Z'),
        account: { equity: usd(1), cash: usd(1), dayPnl: usd(0) },
        positions: [], // everything sold — latest snapshot must NOT leak old positions
      });

      const loaded = await storage.getLatestSnapshot();
      expect(loaded?.positions).toEqual([]);
    });

    it('stores an empty portfolio and reads it back', async () => {
      await storage.saveSnapshot({
        takenAt: new Date('2026-07-06T09:00:00.000Z'),
        account: { equity: usd(500000), cash: usd(500000), dayPnl: usd(0) },
        positions: [],
      });
      const loaded = await storage.getLatestSnapshot();
      expect(loaded?.positions).toEqual([]);
      expect(loaded?.account.cash).toEqual(usd(500000));
    });
  });

  describe('summaries', () => {
    it('round-trips a summary including optional positionsJson', async () => {
      await storage.saveSummary({
        sentAt: new Date('2026-07-06T09:00:00.000Z'),
        kind: 'scheduled',
        text: 'Portfolio flat today.',
        positionsJson: '[{"symbol":"AAPL"}]',
      });

      const [summary] = await storage.getRecentSummaries(10);
      expect(summary).toEqual({
        sentAt: new Date('2026-07-06T09:00:00.000Z'),
        kind: 'scheduled',
        text: 'Portfolio flat today.',
        positionsJson: '[{"symbol":"AAPL"}]',
      });
    });

    it('omits positionsJson when it was not stored', async () => {
      await storage.saveSummary({
        sentAt: new Date('2026-07-06T09:00:00.000Z'),
        kind: 'on_demand',
        text: 'Quick check.',
      });

      const [summary] = await storage.getRecentSummaries(1);
      expect(summary).not.toHaveProperty('positionsJson');
    });

    it('returns newest first and respects the limit', async () => {
      for (const hour of ['09', '11', '13']) {
        await storage.saveSummary({
          sentAt: new Date(`2026-07-06T${hour}:00:00.000Z`),
          kind: 'scheduled',
          text: `summary at ${hour}`,
        });
      }

      const recent = await storage.getRecentSummaries(2);
      expect(recent.map((s) => s.text)).toEqual(['summary at 13', 'summary at 11']);
    });
  });

  describe('alerts', () => {
    const alertAt = (iso: string, subject = 'NVDA') => ({
      firedAt: new Date(iso),
      ruleId: 'position_drop' as const,
      subject,
      changePercent: -4.7,
      tierPercent: 4,
      text: `${subject} dropped`,
      source: 'numeric' as const,
    });

    it('round-trips an alert, most recent first', async () => {
      await storage.saveAlert(alertAt('2026-07-06T09:00:00.000Z', 'NVDA'));
      await storage.saveAlert(alertAt('2026-07-06T11:00:00.000Z', 'AAPL'));

      const recent = await storage.getRecentAlerts(10);
      expect(recent.map((a) => a.subject)).toEqual(['AAPL', 'NVDA']);
      expect(recent[0]?.changePercent).toBe(-4.7);
      expect(recent[0]?.firedAt).toEqual(new Date('2026-07-06T11:00:00.000Z'));
    });

    it('counts only alerts at or after the cutoff (backs the daily cap)', async () => {
      await storage.saveAlert(alertAt('2026-07-05T23:00:00.000Z'));
      await storage.saveAlert(alertAt('2026-07-06T09:00:00.000Z'));
      await storage.saveAlert(alertAt('2026-07-06T10:00:00.000Z'));

      const count = await storage.countAlertsSince(new Date('2026-07-06T00:00:00.000Z'));
      expect(count).toBe(2);
    });
  });

  describe('conversations', () => {
    it('returns the last N turns oldest-first', async () => {
      for (const [index, role] of ['user', 'assistant', 'user', 'assistant'].entries()) {
        await storage.appendConversationTurn({
          at: new Date(Date.UTC(2026, 6, 6, 9, index)),
          role: role as 'user' | 'assistant',
          text: `turn ${index}`,
        });
      }

      const window = await storage.getRecentConversation(3);
      expect(window.map((t) => t.text)).toEqual(['turn 1', 'turn 2', 'turn 3']);
      expect(window[0]?.role).toBe('assistant');
    });
  });

  describe('recommendations', () => {
    const recommendationAt = (iso: string, symbol = 'NVDA') => ({
      madeAt: new Date(iso),
      symbol,
      direction: 'trim' as const,
      rationale: 'up 30% since entry',
      priceCents: 117_500,
      currency: 'USD',
      source: 'summary' as const,
    });

    it('stores a recommendation and returns its id', async () => {
      const id = await storage.saveRecommendation(recommendationAt('2026-07-06T09:00:00.000Z'));
      expect(id).toBeGreaterThan(0);

      const [stored] = await storage.getRecentRecommendations(1);
      expect(stored?.symbol).toBe('NVDA');
      expect(stored?.scores).toEqual({});
    });

    it('lists only recommendations old enough for the horizon and not yet scored', async () => {
      const asOf = new Date('2026-07-10T09:00:00.000Z');
      const oldId = await storage.saveRecommendation(recommendationAt('2026-07-06T09:00:00.000Z'));
      await storage.saveRecommendation(recommendationAt('2026-07-10T08:00:00.000Z', 'AAPL'));

      const due = await storage.getRecommendationsDueForScoring('1d', asOf);
      expect(due.map((r) => r.id)).toEqual([oldId]);

      await storage.recordRecommendationScore(oldId, '1d', -2.5);
      expect(await storage.getRecommendationsDueForScoring('1d', asOf)).toHaveLength(0);
      // 7d has not elapsed for either, so scoring 1d does not leak across horizons
      expect(await storage.getRecommendationsDueForScoring('7d', asOf)).toHaveLength(0);

      const all = await storage.getRecentRecommendations(10);
      expect(all.find((r) => r.id === oldId)?.scores).toEqual({ '1d': -2.5 });
      expect(all.find((r) => r.symbol === 'AAPL')?.scores).toEqual({});
    });
  });

  describe('stats', () => {
    it('counts rows per table and reports a non-zero size', async () => {
      await storage.saveSnapshot(snapshotAt('2026-07-06T09:00:00.000Z'));
      await storage.saveSummary({ sentAt: new Date(), kind: 'scheduled', text: 'hi' });

      const stats = await storage.getStats();
      expect(stats.snapshotCount).toBe(1);
      expect(stats.summaryCount).toBe(1);
      expect(stats.alertCount).toBe(0);
      expect(stats.sizeBytes).toBeGreaterThan(0);
    });
  });

  describe('error translation', () => {
    it('rejects with StorageError, never a raw SQLite error', async () => {
      storage.close(); // force every subsequent call to fail
      await expect(storage.saveSummary({
        sentAt: new Date(),
        kind: 'scheduled',
        text: 'x',
      })).rejects.toBeInstanceOf(StorageError);
    });
  });
});
