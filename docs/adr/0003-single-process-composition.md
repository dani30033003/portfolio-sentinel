# ADR 0003 — One sentinel process, one composition root

**Status:** accepted, 2026-08-11

## Context

Before this change there were two entry points, `main.ts` (build one summary, exit) and
`webhook-main.ts` (long-running Fastify server). Both constructed the same adapters and
services by hand. Adding the watchdog, the scheduler and the scoring job would have meant a
third copy of that wiring, and three places to get "is an LLM configured?" subtly different.

## Decision

Extract the wiring into `src/app/wiring.ts` (`buildContainer`) and run everything in one
process, `src/app/main.ts`:

- scheduled summaries (`node-cron`, evaluated in the user's timezone)
- the watchdog poll loop
- the inbound webhook, started **only** when it can both verify signatures and reply
- a console driver, always
- the nightly recommendation scoring job

`webhook-main.ts` is deleted. `summary-once.ts` keeps the single-shot behaviour for
cron-from-outside deployments.

Command dispatch lives in `src/app/command-handler.ts` and returns reply text. The webhook
and the console driver both call it, so a command cannot behave differently depending on
which transport it arrived through.

## Consequences

- One place decides what "configured" means for WhatsApp, the LLM and storage.
- The console driver makes the entire system runnable with no secrets, which is what makes
  the POC demonstrable and what makes the WhatsApp path optional rather than load-bearing.
- Single process means a crash takes everything down together. Acceptable for single-tenant
  self-hosting; if the watchdog ever needs to survive a webhook crash, splitting them again
  is a compose-file change, not a rewrite — the container is already the seam.
- The poll loop uses a self-scheduling `setTimeout` rather than `setInterval`, so a slow
  poll (an LLM-written alert) cannot have the next poll start on top of it.

## Notes on `node-cron`

Chosen over hand-rolled timers for one reason: "09:00 Asia/Jerusalem, every day" has to
survive DST, and `setTimeout(24h)` does not. `node-cron` takes an IANA timezone directly.
It is in-process, so schedules do not survive a restart gap — a summary due while the
process was down is simply missed, which is the right behaviour for a snapshot that would
already be stale.
