# Portfolio Sentinel — AI Portfolio Agent

An always-on personal service that connects to Interactive Brokers, watches the portfolio continuously, sends AI-written summaries and instant alerts over WhatsApp, answers portfolio questions via WhatsApp, and (in a later phase) executes trades only after explicit human confirmation. Built broker-agnostic from day one.

---

## 1. Goals

1. **Twice-daily summaries** (configurable, default 09:00 and 22:00 Asia/Jerusalem): portfolio snapshot + P&L + market context, written by Claude, delivered to WhatsApp.
2. **Instant alerts**: a rule-based watchdog detects sharp moves (numeric thresholds, no AI in the detection path); Claude is invoked *after* a trigger to write a short, context-aware alert with relevant news.
3. **Interactive queries**: the user can message the bot ("how's my portfolio?", "what happened to NVDA today?") and get an AI answer grounded in live data.
4. **Recommendations, not orders**: Claude may propose actions ("consider trimming X"), framed as analysis with reasoning. Every recommendation is logged with timestamp and price for later evaluation.
5. **(Phase 4) Propose-and-confirm trading**: user replies `CONFIRM <id>` + PIN to execute a proposed order. Hard safety limits enforced in code, never in the prompt.
6. **Broker-agnostic**: all broker access goes through `BrokerPort`. Two adapters exist from day one: `IBKRAdapter` and `PaperBrokerAdapter` (simulated), so the abstraction is validated by two real implementations.

## 2. Non-Goals

- Fully autonomous trading. The AI never places an order without an explicit human confirmation in code-enforced flow.
- Multi-user support. Single-tenant, one user, one phone number. (Regulatory implications of serving others are explicitly out of scope.)
- Beating the market / backtested strategies. This is a monitoring, awareness, and convenience tool.
- High-frequency anything. Polling granularity is ~1 minute.

## 3. Tech Stack

- **Language**: TypeScript (Node.js 22+, ESM), strict mode.
- **IBKR connectivity**: `@stoqey/ib` against IB Gateway (paper account first). The adapter is deliberately thin so it can be swapped for a Python `ib_async` microservice behind the same port if the library proves unreliable — this must not require changes outside the adapter.
- **AI**: Anthropic API (`claude-sonnet-4-6` default; model name in config).
- **Messaging**: WhatsApp Cloud API (Meta). Outbound sends + inbound webhook.
- **Storage**: SQLite via `better-sqlite3`. Single file DB, WAL mode.
- **Scheduler**: `node-cron` (or equivalent) in-process.
- **Webhook server**: Fastify (or Express), HTTPS terminated by the host (VPS + reverse proxy, or Cloudflare Tunnel).
- **MCP server**: `@modelcontextprotocol/sdk`, exposing portfolio tools (see §7).
- **Testing**: Vitest. Unit tests for domain logic; adapter tests against `PaperBrokerAdapter`; contract tests that both broker adapters satisfy the same behavioral suite.
- **Lint/format**: ESLint + Prettier. CI via GitHub Actions (lint, typecheck, test).

## 4. Architecture — Hexagonal (Ports & Adapters)

```
                        ┌───────────────────────────────┐
   inbound adapters     │         DOMAIN CORE           │    outbound ports/adapters
                        │                               │
 WhatsApp webhook ────▶ │  SummaryService               │ ──▶ BrokerPort ──▶ IBKRAdapter / PaperBrokerAdapter
 Cron scheduler   ────▶ │  WatchdogService              │ ──▶ MarketDataPort ─▶ NewsQuotesAdapter (REST)
 MCP server       ────▶ │  QueryService                 │ ──▶ LLMPort ──▶ AnthropicAdapter
                        │  RecommendationService        │ ──▶ MessagingPort ─▶ WhatsAppAdapter
                        │  TradeProposalService (P4)    │ ──▶ StoragePort ──▶ SQLiteAdapter
                        │  SafetyGuard (P4)             │ ──▶ ClockPort ──▶ SystemClock (mockable)
                        └───────────────────────────────┘
```

Rules:
- Domain core has **zero** imports from adapters or SDKs. Ports are TypeScript interfaces defined in the domain layer.
- All money values as integer cents (or `bigint`) + currency code. Never floats for money.
- All timestamps UTC in storage; timezone (`Asia/Jerusalem`) applied only at the presentation edge.
- `ClockPort` everywhere time is read, so tests can control time.

### Port sketches (initial, refine during implementation)

```ts
interface BrokerPort {
  getAccountSummary(): Promise<AccountSummary>;        // equity, cash, buying power, day P&L
  getPositions(): Promise<Position[]>;                 // symbol, qty, avgCost, marketPrice, unrealizedPnL
  getQuotes(symbols: string[]): Promise<Quote[]>;
  placeOrder(order: OrderRequest): Promise<OrderResult>;   // Phase 4 only
  getOrderStatus(orderId: string): Promise<OrderStatus>;   // Phase 4 only
  healthCheck(): Promise<HealthStatus>;                // is the gateway session alive?
}

interface MarketDataPort {
  getNews(symbol: string, since: Date): Promise<NewsItem[]>;
  getMarketStatus(exchange: string): Promise<MarketStatus>; // open/closed/pre/post
}

interface MessagingPort {
  sendMessage(to: PhoneNumber, text: string): Promise<void>;
  // inbound arrives via webhook → parsed into domain InboundMessage
}

interface LLMPort {
  complete(req: { system: string; messages: ChatMessage[]; maxTokens: number }): Promise<string>;
}
```

## 5. Components

### 5.1 Summary loop (scheduled)
- Cron at configured times. Skips or annotates if market closed (weekend summary says so instead of pretending there is fresh data).
- Gathers: account summary, positions, day/total P&L per position, notable news for held symbols since last summary, last few recommendations and their status.
- Claude writes a compact summary (target: fits in 1–2 WhatsApp messages, ~1000 chars each). Tone: factual, no hype, uncertainty acknowledged.
- Persisted to `summaries` table; sent via MessagingPort.

### 5.2 Watchdog (continuous)
- Polls quotes for held symbols every `POLL_INTERVAL` (default 60s) during market hours; reduced cadence (default 15min) outside market hours, and after-hours triggers are labeled as such.
- **Detection is pure math** — configurable rules, evaluated in code:
  - `position_drop`: symbol down ≥ X% within rolling window W (default 4% / 30min)
  - `portfolio_drop`: total equity down ≥ Y% today (default 2%)
  - `level_cross`: price crosses a user-defined level for a symbol
- **Alert hygiene**: per-(symbol, rule) cooldown (default 2h) unless a strictly higher threshold tier is crossed; daily cap on total alerts (default 10); duplicate suppression.
- On trigger: fetch recent news for the symbol via MarketDataPort, ask Claude for a ≤500-char alert explaining what happened and the user's exposure, send immediately. If the LLM call fails, send a plain numeric alert anyway — **alert delivery must not depend on the LLM**.

### 5.3 WhatsApp inbound (webhook)
- Verifies Meta webhook signature (`X-Hub-Signature-256`) on every request; rejects otherwise.
- **Sender auth**: messages accepted only from the whitelisted phone number(s) in config. Everything else is logged and ignored (no reply — do not confirm the bot exists).
- Commands (exact-match, parsed in code before any LLM involvement):
  - `PAUSE` / `RESUME` — kill switch for watchdog alerts and (P4) trading.
  - `STATUS` — system health: gateway session, last poll, DB size, last summary time.
  - `SUMMARY` — trigger an immediate summary.
  - `CONFIRM <id> <PIN>` / `REJECT <id>` — Phase 4 trade flow.
- Anything else → QueryService: Claude answers using live portfolio data + stored context. Conversation history (rolling window) kept per user in DB.

### 5.4 MCP server
- Separate entry point (`src/mcp/`), stdio transport, consuming the *same domain services*.
- Tools: `get_positions`, `get_account_summary`, `get_quotes`, `get_recent_alerts`, `get_recommendation_history`, `get_news`. Phase 4 adds `propose_order` (which creates a proposal requiring WhatsApp confirmation — the MCP tool itself can never execute).
- This makes the repo useful standalone (connect to Claude Desktop/Code) independent of the WhatsApp agent.

### 5.5 Recommendations & evaluation
- Every recommendation Claude produces (in summaries, alerts, or chat) is extracted into a structured record: `{symbol, direction, rationale, price_at_recommendation, timestamp, source}`. Extraction via a second structured-output LLM pass or via prompting Claude to emit a machine-readable block alongside prose.
- A nightly job scores open recommendations against current prices at +1d, +7d, +30d horizons. No automatic action — purely measurement.
- `STATS` command (or MCP tool) reports hit-rate and average move since recommendation. Purpose: honesty about whether the AI adds signal.

### 5.6 SafetyGuard (Phase 4, but designed now)
Code-enforced, config-driven, checked on every order without exception:
- Whitelist of tradable symbols.
- Max order notional value; max shares per order.
- Max orders per day; max daily turnover.
- Limit orders only (no market orders).
- Market-hours-only execution.
- Global kill switch state honored.
- Every proposal, confirmation, rejection, and execution appended to an immutable `audit_log` table (append-only, no UPDATE/DELETE in code paths).

Order lifecycle: Claude proposes → proposal stored with unique short ID + expiry (default 15min) → WhatsApp message with details → user replies `CONFIRM <id> <PIN>` → SafetyGuard validates → order placed via BrokerPort → result reported back. Any failure at any step → clear WhatsApp notification.

## 6. Data model (SQLite, initial)

- `positions_snapshots(ts, symbol, qty, avg_cost_cents, price_cents, unrealized_pnl_cents)`
- `account_snapshots(ts, equity_cents, cash_cents, day_pnl_cents)`
- `alerts(id, ts, rule, symbol, details_json, sent, llm_text)`
- `summaries(id, ts, kind, text, positions_json)`
- `recommendations(id, ts, symbol, direction, rationale, price_cents, source, scored_1d, scored_7d, scored_30d)`
- `conversations(id, ts, role, text)` — rolling window for chat context
- `trade_proposals(id, ts, order_json, status, expires_at)` — Phase 4
- `audit_log(id, ts, actor, action, details_json)` — append-only
- `user_profile(key, value)` — strategy notes, e.g. "long-term investor, no day trades" — injected into every LLM system prompt

## 7. Configuration & secrets

- All config via env vars + a checked-in `config.example.env`. Real `.env` is gitignored.
- Secrets: `IBKR_*` credentials (used by gateway container, not the app), `ANTHROPIC_API_KEY`, `WHATSAPP_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `MARKET_DATA_API_KEY`, `CONFIRM_PIN_HASH` (store a hash, compare constant-time).
- Thresholds, cooldowns, schedule times, whitelists: a `config.yaml` (non-secret) so tuning doesn't require code changes.

## 8. Deployment & ops

- Docker Compose: `app` container + `ib-gateway` container (community `ib-gateway-docker` image with IBC for auto-login, **paper account credentials first**).
- Health monitoring: the app pings `BrokerPort.healthCheck()` every 5 min; if the gateway session is dead for >10 min, send a WhatsApp ops alert ("I'm blind — gateway down"). Silent failure is the worst failure mode for a monitoring tool.
- Structured logging (pino), log rotation, no secrets ever logged.
- Timezone note: US market hours ≈ 16:30–23:00 Asia/Jerusalem (DST-dependent) — compute from exchange calendar via MarketDataPort, never hardcode.

## 9. LLM prompting principles

- System prompt includes: user profile/strategy, current holdings, recent history — and an explicit instruction that outputs are analysis and considerations, **not** financial advice or certainty; require stated reasoning and confidence qualifiers.
- The model is never asked to decide *whether* a numeric threshold was crossed, *whether* an order passes safety checks, or *who* the sender is. All control-flow decisions live in code.
- Inbound free-text is untrusted input: it is user data in the LLM call, never concatenated into system-level instructions; commands are parsed by code before the LLM sees anything.

## 10. Phased roadmap

**Phase 0 — Skeleton (validate the walking skeleton end-to-end)**
Repo scaffold, hexagonal layout, `PaperBrokerAdapter` with fake data, WhatsApp outbound send, one hardcoded "summary" delivered on demand. CI green.

**Phase 1 — Read-only summaries (real broker)**
IB Gateway (paper account) + `IBKRAdapter` read methods, MarketDataPort news adapter, scheduled Claude-written summaries, SQLite snapshots, `STATUS`/`SUMMARY` commands, sender auth + signature verification.

**Phase 2 — Watchdog & alerts**
Polling loop, rules engine, cooldowns/caps, LLM-written alerts with plain-numeric fallback, `PAUSE`/`RESUME`, gateway health alerts.

**Phase 3 — Chat & MCP**
QueryService with conversation memory, MCP server with read tools, recommendation extraction + nightly scoring + `STATS`.

**Phase 4 — Propose-and-confirm trading (paper account only until explicitly promoted)**
Trade proposals, PIN confirmation flow, SafetyGuard, audit log, `placeOrder` in both adapters (paper adapter simulates fills).

Each phase ends with: tests passing, a short demo script in `docs/`, and a tagged release. Do not start a phase before the previous one is deployed and observed working.

## 11. Open questions (decide during Phase 0/1, don't block on them)

1. Exact news/quotes provider for MarketDataPort (free-tier REST; needs: per-symbol news, market calendar). Evaluate 2–3 options and pick in an ADR.
2. Whether Phase 3 chat should also use Anthropic web search tool for "why did X drop" context, vs. news API only (cost/latency tradeoff).
3. Whether `@stoqey/ib` streaming market data is reliable enough vs. polling snapshot quotes (start with polling; ADR if switching).
4. Hosting: home mini-PC + Cloudflare Tunnel vs. small VPS. Either works; decide by Phase 1 deploy.

## 12. Definition of done (per feature)

- Domain logic unit-tested; both broker adapters pass the shared contract test suite.
- No adapter import inside `src/domain/`.
- Feature demonstrable via WhatsApp on the paper account.
- README section updated; ADR written for any non-obvious decision.
