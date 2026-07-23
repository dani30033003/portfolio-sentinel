import { describe, expect, it } from 'vitest';
import { SummaryService } from '../../src/domain/services/summary-service.js';
import type { BrokerPort } from '../../src/domain/ports/broker-port.js';
import type { ClockPort } from '../../src/domain/ports/clock-port.js';
import type { LLMPort } from '../../src/domain/ports/llm-port.js';
import type {
  PortfolioSnapshot,
  StoragePort,
  StoredSummary,
} from '../../src/domain/ports/storage-port.js';
import { LlmError, StorageError } from '../../src/domain/errors.js';

const usd = (amountCents: number) => ({ amountCents, currency: 'USD' });

const stubBroker: BrokerPort = {
  getAccountSummary: async () => ({
    equity: usd(10523010),
    cash: usd(1240000),
    dayPnl: usd(120344),
  }),
  getPositions: async () => [
    {
      symbol: 'AAPL',
      quantity: 10,
      avgCost: usd(15000),
      marketPrice: usd(19530),
      unrealizedPnl: usd(45300),
    },
    {
      symbol: 'MSFT',
      quantity: 5,
      avgCost: usd(40000),
      marketPrice: usd(38000),
      unrealizedPnl: usd(-10000),
    },
  ],
  getQuotes: async () => [],
  healthCheck: async () => ({ ok: true, detail: 'stub' }),
};

// 12:05 UTC = 15:05 in Asia/Jerusalem (UTC+3 in July / DST)
const fixedClock: ClockPort = { now: () => new Date('2026-07-02T12:05:00Z') };

describe('SummaryService.buildSnapshotSummary', () => {
  const service = new SummaryService(stubBroker, fixedClock, 'Asia/Jerusalem');

  it('renders the account line with formatted money', async () => {
    const text = await service.buildSnapshotSummary();
    expect(text).toContain('Equity $105,230.10');
    expect(text).toContain('Cash $12,400.00');
    expect(text).toContain('Day P&L +$1,203.44');
  });

  it('renders one line per position with percent change and signed P&L', async () => {
    const text = await service.buildSnapshotSummary();
    expect(text).toContain('AAPL: 10 @ $150.00 → $195.30 (+30.2%) P&L +$453.00');
    expect(text).toContain('MSFT: 5 @ $400.00 → $380.00 (-5.0%) P&L -$100.00');
  });

  it('formats the timestamp in the configured timezone, not UTC', async () => {
    const text = await service.buildSnapshotSummary();
    expect(text).toContain('2 Jul 2026');
    expect(text).toContain('15:05'); // 12:05 UTC shown as Jerusalem local time
  });
});

describe('SummaryService.buildSummary — LLM path and fallback (hard rule 6)', () => {
  const llmOf = (complete: LLMPort['complete']): LLMPort => ({ complete });

  it('returns the snapshot when no LLM is configured', async () => {
    const service = new SummaryService(stubBroker, fixedClock, 'Asia/Jerusalem');
    const result = await service.buildSummary();
    expect(result.source).toBe('snapshot');
    expect(result.text).toContain('AAPL');
    expect(result.llmError).toBeUndefined();
  });

  it('returns the LLM text when the LLM succeeds', async () => {
    const llm = llmOf(async (req) => {
      // the prompt must carry the real data — guard against an empty snapshot
      expect(req.messages[0]?.content).toContain('AAPL');
      return 'A calm, factual summary.';
    });
    const service = new SummaryService(stubBroker, fixedClock, 'Asia/Jerusalem', {
      llm,
      timeoutMs: 1000,
    });
    const result = await service.buildSummary();
    expect(result).toEqual({ text: 'A calm, factual summary.', source: 'llm' });
  });

  it('falls back to the snapshot when the LLM throws', async () => {
    const llm = llmOf(async () => {
      throw new LlmError('API down');
    });
    const service = new SummaryService(stubBroker, fixedClock, 'Asia/Jerusalem', {
      llm,
      timeoutMs: 1000,
    });
    const result = await service.buildSummary();
    expect(result.source).toBe('snapshot');
    expect(result.text).toContain('Equity $105,230.10');
    expect(result.llmError).toContain('API down');
  });

  it('falls back to the snapshot when the LLM hangs past the timeout', async () => {
    const llm = llmOf(
      () => new Promise((resolve) => setTimeout(() => resolve('too late'), 1000)),
    );
    const service = new SummaryService(stubBroker, fixedClock, 'Asia/Jerusalem', {
      llm,
      timeoutMs: 10,
    });
    const result = await service.buildSummary();
    expect(result.source).toBe('snapshot');
    expect(result.llmError).toContain('timed out');
  });

  it('falls back to the snapshot when the LLM returns empty text', async () => {
    const llm = llmOf(async () => '   ');
    const service = new SummaryService(stubBroker, fixedClock, 'Asia/Jerusalem', {
      llm,
      timeoutMs: 1000,
    });
    const result = await service.buildSummary();
    expect(result.source).toBe('snapshot');
    expect(result.llmError).toContain('empty');
  });
});

/** Records what it was asked to persist; no LLM configured, so text = snapshot. */
class RecordingStorage implements StoragePort {
  readonly snapshots: PortfolioSnapshot[] = [];
  readonly summaries: StoredSummary[] = [];
  saveSnapshot(snapshot: PortfolioSnapshot): Promise<void> {
    this.snapshots.push(snapshot);
    return Promise.resolve();
  }
  getLatestSnapshot(): Promise<PortfolioSnapshot | null> {
    return Promise.resolve(this.snapshots.at(-1) ?? null);
  }
  saveSummary(summary: StoredSummary): Promise<void> {
    this.summaries.push(summary);
    return Promise.resolve();
  }
  getRecentSummaries(limit: number): Promise<StoredSummary[]> {
    return Promise.resolve(this.summaries.slice(-limit).reverse());
  }
}

describe('SummaryService.buildSummary — persistence', () => {
  it('persists the snapshot and the summary when storage is configured', async () => {
    const storage = new RecordingStorage();
    const service = new SummaryService(stubBroker, fixedClock, 'Asia/Jerusalem', undefined, storage);

    const result = await service.buildSummary('scheduled');

    expect(result.storageError).toBeUndefined();
    expect(storage.snapshots).toHaveLength(1);
    expect(storage.snapshots[0]?.positions.map((p) => p.symbol)).toEqual(['AAPL', 'MSFT']);
    expect(storage.summaries).toHaveLength(1);
    expect(storage.summaries[0]?.kind).toBe('scheduled');
    expect(storage.summaries[0]?.text).toBe(result.text);
    // snapshot and summary share the single clock reading
    expect(storage.summaries[0]?.sentAt).toEqual(storage.snapshots[0]?.takenAt);
    // positionsJson captures what the summary was written about
    expect(storage.summaries[0]?.positionsJson).toContain('AAPL');
  });

  it('persists nothing when no storage is configured', async () => {
    const service = new SummaryService(stubBroker, fixedClock, 'Asia/Jerusalem');
    const result = await service.buildSummary('on_demand');
    expect(result.storageError).toBeUndefined();
    expect(result.text).toContain('AAPL');
  });

  it('surfaces storageError but still returns sendable text when persistence fails', async () => {
    const failing: StoragePort = {
      saveSnapshot: () => Promise.reject(new StorageError('disk full')),
      getLatestSnapshot: () => Promise.resolve(null),
      saveSummary: () => Promise.resolve(),
      getRecentSummaries: () => Promise.resolve([]),
    };
    const service = new SummaryService(stubBroker, fixedClock, 'Asia/Jerusalem', undefined, failing);

    const result = await service.buildSummary('scheduled');

    expect(result.text).toContain('Equity $105,230.10'); // still sendable
    expect(result.storageError).toContain('disk full');
  });
});
