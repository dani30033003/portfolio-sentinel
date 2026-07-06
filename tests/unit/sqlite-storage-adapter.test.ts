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
