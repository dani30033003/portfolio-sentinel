# Portfolio Sentinel

An always-on personal service: brokerage account → hexagonal domain core → LLM-written
summaries, alerts and answers → WhatsApp (or your terminal).

The POC runs with **no accounts, no API keys and no network access**. Prices come from a
seeded market simulator behind the same `BrokerPort` a real IBKR adapter will implement,
so the watchdog, the alerts and the chat are all exercised for real.

## Run it

```sh
npm install
npm run dev
```

You get a prompt. Everything the WhatsApp bot can do, you can do here:

```
> SUMMARY                 portfolio snapshot now
> STATUS                  system health: uptime, broker, last poll, stored rows
> STATS                   how past recommendations have scored
> PAUSE / RESUME          mute and unmute alerts
> HELP                    the command list
> how is NVDA doing?      anything else is a question for the LLM
```

Two extra commands exist only because prices are simulated:

```
> SHOCK NVDA -8           move a price now and poll immediately
> POLL                    run a watchdog cycle immediately
> QUIT                    stop the process
```

### See an alert fire

```sh
POLL_INTERVAL_MS=3000 SIM_TICK_MS=1000 npm run dev
```

then `SHOCK NVDA -8`. The watchdog measures the drop from the window peak, the alert
policy decides it is worth saying, and the message is delivered:

```
ALERT NVDA -7.6% from its recent high: $1,175.00 to $1,085.16. Position: 8 shares, P&L +$1,481.28.
```

Shock it again immediately and nothing is sent — that is the per-(rule, symbol) cooldown.
Shock it far enough to cross a higher tier and it speaks up again, because a −13% move is
news even though a second −4% move is not.

## What is running

| Piece | What it does |
| --- | --- |
| Scheduler | Summaries at 09:00 and 22:00 in your timezone (`SUMMARY_SCHEDULE`) |
| Watchdog | Polls prices every `POLL_INTERVAL_MS`, runs the rules, sends alerts |
| Webhook | Inbound WhatsApp commands, if Meta credentials are configured |
| Console driver | The same commands, over the terminal, always |
| Scoring job | Nightly: scores past recommendations at 1d/7d/30d |
| MCP server | `npm run mcp` — the same data as tools for an MCP client |

Everything degrades rather than refusing to start:

- No `WHATSAPP_*` → messages print to the console.
- No LLM key → summaries, alerts and answers are deterministic numeric text.
- LLM configured but failing or slow → the numeric text is sent instead. **Alert delivery
  never depends on the LLM.**

## Commands

```sh
npm run dev            # the sentinel: scheduler + watchdog + inbound commands
npm run summary        # build one summary, send it, exit
npm run mcp            # MCP server over stdio
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm test               # vitest run
npm run test:contract  # broker adapter contract suite
```

## Configuration

Copy `config.example.env` to `.env` and fill in only what you want. Every value has a
working default; secrets are never required to run the POC.

Useful knobs:

| Variable | Default | Meaning |
| --- | --- | --- |
| `POLL_INTERVAL_MS` | `60000` | Watchdog poll cadence |
| `WATCHDOG_POSITION_TIERS` | `4,7,10` | Position drop tiers, percent |
| `WATCHDOG_WINDOW_MS` | `1800000` | Rolling window the drop is measured over |
| `WATCHDOG_PORTFOLIO_TIERS` | `2,4,6` | Whole-account drop tiers for today |
| `WATCHDOG_LEVELS` | – | `NVDA:below:100000,AAPL:above:25000` (price in cents) |
| `ALERT_COOLDOWN_MS` | `7200000` | Silence per (rule, symbol) unless a higher tier hits |
| `ALERT_DAILY_CAP` | `10` | Hard ceiling on alerts per day |
| `SIM_SEED` / `SIM_VOLATILITY` | `1` / `0.004` | Simulated price path |
| `USER_PROFILE` | – | Strategy notes injected into every LLM prompt |

## Architecture

Hexagonal. `src/domain/` has no imports from adapters, SDKs or I/O libraries — it defines
ports, and adapters implement them.

```
src/
  domain/      entities, ports, services, prompts   (pure TypeScript)
  adapters/    broker-paper, llm-anthropic, llm-gemini, messaging-whatsapp,
               messaging-console, storage-sqlite, clock-system
  app/         wiring (composition root), main, command handler, console driver
  webhook/     Fastify server for inbound WhatsApp
  mcp/         MCP server entry point
```

Rules that hold everywhere: money is integer cents plus a currency code, never a float;
timestamps are UTC in storage and localized only for display; detection is deterministic
code, and the LLM is only ever asked to write prose about a decision already made.

See `docs/adr/` for the decisions that were not obvious, and `docs/demo.md` for a
five-minute walkthrough.
