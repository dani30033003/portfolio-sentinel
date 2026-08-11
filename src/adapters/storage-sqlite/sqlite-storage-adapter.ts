import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { StorageError } from '../../domain/errors.js';
import type { Alert, AlertRuleId } from '../../domain/entities/alert.js';
import type {
  Recommendation,
  RecommendationDirection,
  RecommendationSource,
  ScoreHorizon,
  StoredRecommendation,
} from '../../domain/entities/recommendation.js';
import { SCORE_HORIZON_DAYS } from '../../domain/entities/recommendation.js';
import type {
  ConversationTurn,
  PortfolioSnapshot,
  StoragePort,
  StorageStats,
  StoredSummary,
  SummaryKind,
} from '../../domain/ports/storage-port.js';
import { SCHEMA_SQL } from './schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Horizon → column name. A fixed map, so no caller-supplied SQL identifier. */
const SCORE_COLUMNS: Record<ScoreHorizon, string> = {
  '1d': 'score_1d',
  '7d': 'score_7d',
  '30d': 'score_30d',
};

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

interface AlertRow {
  fired_at: string;
  rule_id: string;
  subject: string;
  change_percent: number;
  tier_percent: number;
  text: string;
  source: string;
}

interface ConversationRow {
  at: string;
  role: string;
  text: string;
}

interface RecommendationRow {
  id: number;
  made_at: string;
  symbol: string;
  direction: string;
  rationale: string;
  price_cents: number;
  currency: string;
  source: string;
  score_1d: number | null;
  score_7d: number | null;
  score_30d: number | null;
}

function toStoredRecommendation(row: RecommendationRow): StoredRecommendation {
  const scores: Partial<Record<ScoreHorizon, number>> = {};
  if (row.score_1d !== null) scores['1d'] = row.score_1d;
  if (row.score_7d !== null) scores['7d'] = row.score_7d;
  if (row.score_30d !== null) scores['30d'] = row.score_30d;
  return {
    id: row.id,
    madeAt: new Date(row.made_at),
    symbol: row.symbol,
    direction: row.direction as RecommendationDirection,
    rationale: row.rationale,
    priceCents: row.price_cents,
    currency: row.currency,
    source: row.source as RecommendationSource,
    scores,
  };
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
    // better-sqlite3 creates the DB file but NOT its parent directory, so a
    // configured path like ./data/app.db would throw on a fresh checkout.
    // Create the directory here — the adapter owns its file, so both
    // composition roots stay ignorant of the filesystem. Skipped for :memory:.
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true });
    }
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

  saveAlert(alert: Alert): Promise<void> {
    return this.run(() => {
      this.db
        .prepare(
          'INSERT INTO alerts (fired_at, rule_id, subject, change_percent, tier_percent, ' +
            'text, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          alert.firedAt.toISOString(),
          alert.ruleId,
          alert.subject,
          alert.changePercent,
          alert.tierPercent,
          alert.text,
          alert.source,
        );
    });
  }

  getRecentAlerts(limit: number): Promise<Alert[]> {
    return this.run(() => {
      const rows = this.db
        .prepare('SELECT * FROM alerts ORDER BY fired_at DESC, id DESC LIMIT ?')
        .all(limit) as AlertRow[];
      return rows.map((row) => ({
        firedAt: new Date(row.fired_at),
        ruleId: row.rule_id as AlertRuleId,
        subject: row.subject,
        changePercent: row.change_percent,
        tierPercent: row.tier_percent,
        text: row.text,
        source: row.source as Alert['source'],
      }));
    });
  }

  countAlertsSince(since: Date): Promise<number> {
    return this.run(() => {
      const row = this.db
        .prepare('SELECT COUNT(*) AS count FROM alerts WHERE fired_at >= ?')
        .get(since.toISOString()) as { count: number };
      return row.count;
    });
  }

  appendConversationTurn(turn: ConversationTurn): Promise<void> {
    return this.run(() => {
      this.db
        .prepare('INSERT INTO conversations (at, role, text) VALUES (?, ?, ?)')
        .run(turn.at.toISOString(), turn.role, turn.text);
    });
  }

  getRecentConversation(limit: number): Promise<ConversationTurn[]> {
    return this.run(() => {
      // Take the newest N, then flip to chronological order: an LLM needs the
      // transcript oldest-first, but "recent" has to be selected newest-first.
      const rows = this.db
        .prepare('SELECT at, role, text FROM conversations ORDER BY at DESC, id DESC LIMIT ?')
        .all(limit) as ConversationRow[];
      return rows.reverse().map((row) => ({
        at: new Date(row.at),
        role: row.role as ConversationTurn['role'],
        text: row.text,
      }));
    });
  }

  saveRecommendation(recommendation: Recommendation): Promise<number> {
    return this.run(() => {
      const result = this.db
        .prepare(
          'INSERT INTO recommendations (made_at, symbol, direction, rationale, price_cents, ' +
            'currency, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          recommendation.madeAt.toISOString(),
          recommendation.symbol,
          recommendation.direction,
          recommendation.rationale,
          recommendation.priceCents,
          recommendation.currency,
          recommendation.source,
        );
      return Number(result.lastInsertRowid);
    });
  }

  getRecentRecommendations(limit: number): Promise<StoredRecommendation[]> {
    return this.run(() => {
      const rows = this.db
        .prepare('SELECT * FROM recommendations ORDER BY made_at DESC, id DESC LIMIT ?')
        .all(limit) as RecommendationRow[];
      return rows.map(toStoredRecommendation);
    });
  }

  getRecommendationsDueForScoring(
    horizon: ScoreHorizon,
    asOf: Date,
  ): Promise<StoredRecommendation[]> {
    return this.run(() => {
      // The column is chosen from a fixed map, never interpolated from input —
      // SQLite cannot parameterize identifiers, so this is the safe equivalent.
      const column = SCORE_COLUMNS[horizon];
      const cutoff = new Date(asOf.getTime() - SCORE_HORIZON_DAYS[horizon] * DAY_MS);
      const rows = this.db
        .prepare(
          `SELECT * FROM recommendations WHERE ${column} IS NULL AND made_at <= ? ` +
            'ORDER BY made_at ASC',
        )
        .all(cutoff.toISOString()) as RecommendationRow[];
      return rows.map(toStoredRecommendation);
    });
  }

  recordRecommendationScore(
    id: number,
    horizon: ScoreHorizon,
    changePercent: number,
  ): Promise<void> {
    return this.run(() => {
      const column = SCORE_COLUMNS[horizon];
      this.db
        .prepare(`UPDATE recommendations SET ${column} = ? WHERE id = ?`)
        .run(changePercent, id);
    });
  }

  getStats(): Promise<StorageStats> {
    return this.run(() => {
      const count = (table: string): number =>
        (this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number })
          .count;
      // No fs.stat: the file on disk lags WAL content, and :memory: has no
      // file at all. page_count × page_size is what SQLite itself believes.
      const pageCount = this.db.pragma('page_count', { simple: true }) as number;
      const pageSize = this.db.pragma('page_size', { simple: true }) as number;
      return {
        snapshotCount: count('account_snapshots'),
        summaryCount: count('summaries'),
        alertCount: count('alerts'),
        recommendationCount: count('recommendations'),
        sizeBytes: pageCount * pageSize,
      };
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
