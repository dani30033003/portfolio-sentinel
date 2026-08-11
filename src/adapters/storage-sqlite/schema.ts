/**
 * Schema through Phase 3: snapshots, summaries, alerts, conversations,
 * recommendations. `audit_log` arrives with Phase 4 trading, and only then —
 * it has no meaning until something can act.
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

CREATE TABLE IF NOT EXISTS alerts (
  id              INTEGER PRIMARY KEY,
  fired_at        TEXT    NOT NULL,
  rule_id         TEXT    NOT NULL,
  subject         TEXT    NOT NULL,
  change_percent  REAL    NOT NULL,
  tier_percent    REAL    NOT NULL,
  text            TEXT    NOT NULL,
  source          TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_fired_at
  ON alerts (fired_at);

CREATE TABLE IF NOT EXISTS conversations (
  id    INTEGER PRIMARY KEY,
  at    TEXT NOT NULL,
  role  TEXT NOT NULL,
  text  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_at
  ON conversations (at);

-- One row per recommendation; the score_* columns are filled in later by the
-- scoring job. NULL means "not yet scored at that horizon", which is what
-- getRecommendationsDueForScoring selects on.
CREATE TABLE IF NOT EXISTS recommendations (
  id          INTEGER PRIMARY KEY,
  made_at     TEXT    NOT NULL,
  symbol      TEXT    NOT NULL,
  direction   TEXT    NOT NULL,
  rationale   TEXT    NOT NULL,
  price_cents INTEGER NOT NULL,
  currency    TEXT    NOT NULL,
  source      TEXT    NOT NULL,
  score_1d    REAL,
  score_7d    REAL,
  score_30d   REAL
);
CREATE INDEX IF NOT EXISTS idx_recommendations_made_at
  ON recommendations (made_at);
`;
