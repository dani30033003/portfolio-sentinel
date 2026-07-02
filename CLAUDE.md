# CLAUDE.md — Portfolio Sentinel

Working instructions for Claude Code on this repository. Read `PROJECT_SPEC.md` first; it is the source of truth for scope and architecture. This file covers *how* to work here.

## What this project is

A single-tenant TypeScript service: Interactive Brokers (paper account) → hexagonal domain core → Claude-written summaries/alerts/answers → WhatsApp. Plus an MCP server exposing the same domain services. Trading (Phase 4) is propose-and-confirm only, gated by code-enforced SafetyGuard.

## Hard rules — never violate

1. **No secrets in the repo.** No API keys, tokens, phone numbers, or account IDs in code, tests, fixtures, or docs. Use env vars; keep `config.example.env` updated with placeholder values.
2. **Domain purity.** Nothing under `src/domain/` may import from `src/adapters/`, any SDK, or any I/O library. Ports are interfaces defined in the domain. If you need something from the outside world, add or extend a port.
3. **Money is never a float.** Integer cents (or `bigint`) + ISO currency code everywhere. Timestamps stored in UTC.
4. **The LLM never controls execution.** No code path may place, modify, or cancel an order based on LLM output without a human `CONFIRM <id> <PIN>` message and a passing SafetyGuard check. Safety limits live in code/config, never in prompts.
5. **Detection is deterministic.** Watchdog trigger logic is pure functions over numbers — unit-testable without mocking an LLM. The LLM is only called *after* a trigger, to write text.
6. **Alerts must not depend on the LLM.** If the Anthropic call fails or times out, send the plain numeric alert. Wrap LLM calls with timeout + fallback.
7. **Inbound messages are untrusted.** Verify Meta webhook signatures; enforce the sender whitelist before any processing; parse commands with exact-match code, not the LLM; pass free text to the LLM only as user-role content.
8. **Audit log is append-only.** No UPDATE or DELETE statements against `audit_log`, ever.
9. **Paper account only** until the human explicitly changes `BROKER_MODE=live` — and even then, SafetyGuard limits still apply. Never suggest flipping this flag.
10. **Don't invent broker behavior.** If unsure how IBKR/`@stoqey/ib` behaves (order statuses, pacing limits, contract details), say so and check docs or write a spike test against the paper gateway — do not guess silently.

## Repository layout

```
src/
  domain/            # entities, ports (interfaces), services — pure TS, no I/O
    ports/
    services/
    entities/
  adapters/
    broker-ibkr/     # @stoqey/ib wrapper. Thin. Swappable.
    broker-paper/    # simulated broker; also the test double
    marketdata/      # news + market calendar REST adapter
    llm-anthropic/
    messaging-whatsapp/
    storage-sqlite/
  app/               # composition root, config loading, scheduler wiring
  webhook/           # Fastify server for WhatsApp inbound
  mcp/               # MCP server entry point (stdio)
tests/
  contract/          # shared suite both broker adapters must pass
  unit/
docs/
  adr/               # architecture decision records, numbered
config.example.env
config.yaml          # non-secret tunables: thresholds, cooldowns, schedules
```

## Commands

```bash
npm run dev            # run app locally (paper adapter unless configured)
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm test               # vitest run
npm run test:contract  # broker adapter contract suite
npm run mcp            # start MCP server (stdio)
docker compose up      # app + ib-gateway (paper)
```

Always run `typecheck`, `lint`, and `test` before declaring a task done.

## Learning protocol — this overrides speed

The human's explicit goal is to understand this codebase as deeply as if they had written every line themselves. Optimizing for fast code generation at the expense of their understanding is a failure, even if the code is perfect. Operate as a pairing partner, not a code generator:

1. **Design before code.** For any non-trivial task, first present the approach in a few sentences (what changes, where, why, alternatives considered) and wait for approval before writing code. If the human says "just do it," still include a 2–3 line rationale with the diff.
2. **Driver/navigator is interchangeable.** Sometimes the human writes the code and you review; sometimes you write and they review. When the human is driving, give hints and direction, not finished code — Socratic style. Never paste a full solution while they're mid-attempt unless they explicitly ask.
3. **Human-owned modules.** The following are implemented by the human (you may review, hint, and pair, but not write first drafts): watchdog rules engine, SafetyGuard, money math utilities, and the command parser. These are chosen because they're small, testable, and concentrate the most important logic in the system.
4. **Explain-back checkpoints.** At the end of each phase, produce 3–5 questions about what was built (e.g., "why does the cooldown use threshold tiers?", "what happens if the gateway dies mid-poll?"). The human answers in their own words; correct misunderstandings before moving on. Log these in `docs/learning-log.md`.
5. **No magic.** Every dependency added and every non-obvious pattern used (e.g., WAL mode, constant-time compare, ESM quirks) gets a one-paragraph explanation at the moment it's introduced — what it is, why here, what would break without it.
6. **Refactor narration.** When you restructure existing code, explain what smell prompted it. The human should learn to *see* the smell, not just receive the fix.
7. **Interview lens.** Once per phase, note which parts of what was just built make strong interview talking points and what a skeptical interviewer would probe.

## Workflow expectations

- **Phase discipline.** Implement phases in order (see spec §10). Within a phase, prefer vertical slices that can be demoed over WhatsApp.
- **TDD where it pays.** Watchdog rules, cooldown logic, SafetyGuard, money math, command parsing: write tests first. Adapters: contract tests + a thin integration test.
- **ADRs for non-obvious choices** (news provider, streaming vs polling, library swaps): one short markdown file in `docs/adr/`, numbered, ~1 page.
- **Small commits, imperative messages**, e.g. `feat(watchdog): add per-symbol cooldown tiers`.
- **When the IBKR library fights you**, isolate the pain inside the adapter and keep the port clean. If it's bad enough to consider the Python `ib_async` sidecar fallback, write an ADR proposing it — do not start the rewrite unprompted.
- **Ask before**: adding new external services/dependencies with signup requirements, changing DB schema after Phase 1, anything touching order placement, or anything that would send messages to a real phone number in tests (use a dry-run messaging adapter in tests).

## Style

- TypeScript strict; no `any` without an eslint-disable comment explaining why.
- ESM imports, named exports preferred.
- Errors: typed domain errors (`GatewayDownError`, `SafetyViolationError`...) — never throw raw strings; adapters translate SDK errors into domain errors at the boundary.
- Logging: pino, structured fields (`{component, symbol, ruleId}`), no secrets, no message bodies of the user's chat at info level (debug only).
- Prompts to Claude live in `src/domain/prompts/` as typed template functions with unit tests asserting required elements are present (user profile, disclaimer framing, holdings).

## Environment notes

- Developer machine: Arch-based Linux (CachyOS), Fish shell — write shell examples POSIX-compatible or note Fish syntax.
- Timezone: system runs in UTC; user-facing times formatted in `Asia/Jerusalem`.
- IB Gateway runs in Docker via the community ib-gateway image with IBC auto-login; app connects to it over the compose network.
