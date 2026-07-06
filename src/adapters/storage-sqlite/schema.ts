/**
 * Phase-1 schema only (spec §"storage"): snapshots + summaries. The alerts,
 * recommendations and audit_log tables arrive with their phases — adding them
 * now would be schema we can't yet test against real usage.
 *
 * Conventions:
 * - Money: integer minor-units column + ISO currency column, mirroring the
 *   domain Money type. Never REAL — SQLite would happily store 0.1+0.2.
 * - Timestamps: TEXT, UTC ISO 8601 ("2026-07-06T09:00:00.000Z"). ISO-8601
 *   strings sort lexicographically in time order, so ORDER BY / indexes work
 *   without a date type (SQLite has none).
 * - quantity is REAL because share counts aren't money — brokers allow
 *   fractional shares, and no arithmetic is done on it in SQL.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS account_snapshots (
  id                INTEGER PRIMARY KEY,
  taken_at          TEXT    NOT NULL,
  equity_cents      INTEGER NOT NULL,
  equity_currency   TEXT    NOT NULL,
  cash_cents        INTEGER NOT NULL,
  cash_currency     TEXT    NOT NULL,
  day_pnl_cents     INTEGER NOT NULL,
  day_pnl_currency  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_snapshots_taken_at
  ON account_snapshots (taken_at);

CREATE TABLE IF NOT EXISTS positions_snapshots (
  id                       INTEGER PRIMARY KEY,
  snapshot_id              INTEGER NOT NULL
                             REFERENCES account_snapshots (id) ON DELETE CASCADE,
  symbol                   TEXT    NOT NULL,
  quantity                 REAL    NOT NULL,
  avg_cost_cents           INTEGER NOT NULL,
  avg_cost_currency        TEXT    NOT NULL,
  market_price_cents       INTEGER NOT NULL,
  market_price_currency    TEXT    NOT NULL,
  unrealized_pnl_cents     INTEGER NOT NULL,
  unrealized_pnl_currency  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_positions_snapshots_snapshot_id
  ON positions_snapshots (snapshot_id);

CREATE TABLE IF NOT EXISTS summaries (
  id              INTEGER PRIMARY KEY,
  sent_at         TEXT NOT NULL,
  kind            TEXT NOT NULL,
  text            TEXT NOT NULL,
  positions_json  TEXT
);
CREATE INDEX IF NOT EXISTS idx_summaries_sent_at
  ON summaries (sent_at);
`;
