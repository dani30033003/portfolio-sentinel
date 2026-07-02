# Portfolio Sentinel

An always-on personal service: Interactive Brokers (paper account) → hexagonal domain core →
LLM-written summaries/alerts/answers → WhatsApp.

## Status

**Phase 0 — walking skeleton.** Paper broker with fixture data, deterministic (no-LLM) summary,
WhatsApp outbound send with console dry-run fallback. No webhook, scheduler, LLM, or storage yet.

## Setup

```sh
npm install
cp config.example.env .env   # optional — without it, summaries print to the console
```

## Commands

```sh
npm run dev            # build one summary from the paper broker and send/print it
npm run summary        # same as dev (the Phase 0 on-demand trigger)
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm test               # vitest run
npm run test:contract  # broker adapter contract suite
```
