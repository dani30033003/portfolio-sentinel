import Database from 'better-sqlite3';
import { StorageError } from '../../domain/errors.js';
import type {
  PortfolioSnapshot,
  StoragePort,
  StoredSummary,
  SummaryKind,
} from '../../domain/ports/storage-port.js';
import { SCHEMA_SQL } from './schema.js';

interface AccountRow {
  id: number;
  taken_at: string;
  equity_cents: number;
  equity_currency: string;
  cash_cents: number;
  cash_currency: string;
  day_pnl_cents: number;
  day_pnl_currency: string;
}

interface PositionRow {
  symbol: string;
  quantity: number;
  avg_cost_cents: number;
  avg_cost_currency: string;
  market_price_cents: number;
  market_price_currency: string;
  unrealized_pnl_cents: number;
  unrealized_pnl_currency: string;
}

interface SummaryRow {
  sent_at: string;
  kind: string;
  text: string;
  positions_json: string | null;
}

/**
 * better-sqlite3 is fully synchronous — no event loop round-trip per query.
 * That's a feature here, not a compromise: SQLite reads from a local file, so
 * there's no network wait for async to hide, and sync calls make transactions
 * trivially correct (no interleaving). The StoragePort stays Promise-based so
 * the domain never knows, and a future networked store wouldn't change it.
 */
export class SqliteStorageAdapter implements StoragePort {
  private readonly db: Database.Database;
  private readonly saveSnapshotTx: (snapshot: PortfolioSnapshot) => void;

  /** @param path a file path, or ':memory:' for an ephemeral DB (tests). */
  constructor(path: string) {
    this.db = new Database(path);
    // WAL: writes go to a separate log file instead of rewriting the main DB
    // in place, so the scheduler can write a snapshot while a webhook request
    // reads one — readers never block the writer or vice versa. The default
    // journal mode would give "database is locked" under that overlap.
    this.db.pragma('journal_mode = WAL');
    // SQLite ignores REFERENCES clauses unless this is on (legacy default).
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);

    const insertAccount = this.db.prepare(`
      INSERT INTO account_snapshots
        (taken_at, equity_cents, equity_currency, cash_cents, cash_currency,
         day_pnl_cents, day_pnl_currency)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPosition = this.db.prepare(`
      INSERT INTO positions_snapshots
        (snapshot_id, symbol, quantity, avg_cost_cents, avg_cost_currency,
         market_price_cents, market_price_currency,
         unrealized_pnl_cents, unrealized_pnl_currency)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    // .transaction() wraps the function in BEGIN/COMMIT and rolls back if it
    // throws — the account row and its position rows land together or not at all.
    this.saveSnapshotTx = this.db.transaction((snapshot: PortfolioSnapshot) => {
      const { account } = snapshot;
      const result = insertAccount.run(
        snapshot.takenAt.toISOString(),
        account.equity.amountCents,
        account.equity.currency,
        account.cash.amountCents,
        account.cash.currency,
        account.dayPnl.amountCents,
        account.dayPnl.currency,
      );
      for (const p of snapshot.positions) {
        insertPosition.run(
          result.lastInsertRowid,
          p.symbol,
          p.quantity,
          p.avgCost.amountCents,
          p.avgCost.currency,
          p.marketPrice.amountCents,
          p.marketPrice.currency,
          p.unrealizedPnl.amountCents,
          p.unrealizedPnl.currency,
        );
      }
    });
  }

  saveSnapshot(snapshot: PortfolioSnapshot): Promise<void> {
    return this.run(() => {
      this.saveSnapshotTx(snapshot);
    });
  }

  getLatestSnapshot(): Promise<PortfolioSnapshot | null> {
    return this.run(() => {
      const account = this.db
        .prepare('SELECT * FROM account_snapshots ORDER BY taken_at DESC, id DESC LIMIT 1')
        .get() as AccountRow | undefined;
      if (!account) return null;

      const positions = this.db
        .prepare('SELECT * FROM positions_snapshots WHERE snapshot_id = ? ORDER BY symbol')
        .all(account.id) as PositionRow[];

      return {
        takenAt: new Date(account.taken_at),
        account: {
          equity: { amountCents: account.equity_cents, currency: account.equity_currency },
          cash: { amountCents: account.cash_cents, currency: account.cash_currency },
          dayPnl: { amountCents: account.day_pnl_cents, currency: account.day_pnl_currency },
        },
        positions: positions.map((row) => ({
          symbol: row.symbol,
          quantity: row.quantity,
          avgCost: { amountCents: row.avg_cost_cents, currency: row.avg_cost_currency },
          marketPrice: {
            amountCents: row.market_price_cents,
            currency: row.market_price_currency,
          },
          unrealizedPnl: {
            amountCents: row.unrealized_pnl_cents,
            currency: row.unrealized_pnl_currency,
          },
        })),
      };
    });
  }

  saveSummary(summary: StoredSummary): Promise<void> {
    return this.run(() => {
      this.db
        .prepare('INSERT INTO summaries (sent_at, kind, text, positions_json) VALUES (?, ?, ?, ?)')
        .run(
          summary.sentAt.toISOString(),
          summary.kind,
          summary.text,
          summary.positionsJson ?? null,
        );
    });
  }

  getRecentSummaries(limit: number): Promise<StoredSummary[]> {
    return this.run(() => {
      const rows = this.db
        .prepare(
          'SELECT sent_at, kind, text, positions_json FROM summaries ' +
            'ORDER BY sent_at DESC, id DESC LIMIT ?',
        )
        .all(limit) as SummaryRow[];
      return rows.map((row) => ({
        sentAt: new Date(row.sent_at),
        kind: row.kind as SummaryKind,
        text: row.text,
        ...(row.positions_json !== null ? { positionsJson: row.positions_json } : {}),
      }));
    });
  }

  /** Flushes WAL and releases the file handles. Idempotent. */
  close(): void {
    this.db.close();
  }

  /** Adapter boundary: SQLite errors leave here only as domain StorageErrors. */
  private run<T>(fn: () => T): Promise<T> {
    try {
      return Promise.resolve(fn());
    } catch (error) {
      return Promise.reject(
        new StorageError(error instanceof Error ? error.message : String(error)),
      );
    }
  }
}
