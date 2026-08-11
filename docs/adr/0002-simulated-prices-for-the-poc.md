# ADR 0002 — Simulated prices as the POC's data source

**Status:** accepted, 2026-08-11

## Context

Phase 1 was blocked on an IBKR paper account that did not exist yet. Meanwhile the parts
that actually make this system interesting — the watchdog, alert hygiene, chat grounded in
live data — cannot be demonstrated against a frozen fixture portfolio: nothing ever moves,
so no rule ever fires.

Three options were on the table:

1. Wait for the paper account and build nothing until IB Gateway logs in.
2. Point the adapter at a real market data feed for prices, keeping positions fake.
3. Generate prices locally with a deterministic simulator behind the existing
   `PaperBrokerAdapter`.

## Decision

Option 3. `MarketSimulator` produces a seeded random walk; `PaperBrokerAdapter` derives
market value, unrealized P&L and day P&L from those live prices rather than storing them.

The key property is that prices are a pure function of `(seed, ticks elapsed)`, not of
wall-clock jitter. That gives two things at once:

- **Movement**, so alerts fire and the whole Phase 2 path is exercised.
- **Reproducibility**, so a test asserting "an alert fires" is not asserting "we got lucky".

A `shock(symbol, fraction)` method makes a move happen on demand, which is what the console
`SHOCK` command uses for demos.

## Consequences

- The domain, the watchdog, the storage schema and the alert policy are all built and
  tested against something that behaves like a market, months before IBKR credentials exist.
- `BrokerPort` is unchanged, so `IBKRAdapter` remains a drop-in: the contract suite in
  `tests/contract/` is what will hold it to the same behaviour.
- What the simulator does **not** validate: IBKR pacing limits, order-status semantics,
  contract resolution, gateway session death. Those are adapter concerns and still need a
  spike against the real paper gateway (see ADR 0001).
- Nobody should ever mistake simulated numbers for real ones. `healthCheck()` reports
  `paper broker (simulated)` and `STATUS` prints it.

## Alternatives rejected

- **Real market data for prices:** adds a provider signup, an API key and rate limits to
  something whose only job right now is "make a number move".
- **`Math.random()`:** no seed, so no reproducible test could assert on a trigger.
