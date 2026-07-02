# Learning log

Explain-back checkpoints per phase (CLAUDE.md learning protocol #4). Questions are logged
at phase end; answers are added when the human returns to them, before the phase is
considered closed.

## Phase 0 — walking skeleton

1. Why does `Money` store `amountCents` as an integer instead of a `number` in dollars? What
   specifically goes wrong if we used floats?
2. In `formatMoney`, you divide by 100 to get major units before calling
   `Intl.NumberFormat`. Why is that division safe here but would be unsafe if it happened
   inside, say, `addMoney`?
3. `SummaryService` takes a `BrokerPort`, not a `PaperBrokerAdapter`, in its constructor.
   What does that buy us, concretely — what could you swap in without touching
   `SummaryService` at all?
4. `ClockPort` exists so tests can pass a `fixedClock`. Why does that matter for a function
   like `buildSnapshotSummary` that renders a timestamp — what would testing look like
   without it?
5. The contract suite (`tests/contract/broker-port.contract.ts`) runs today against only
   `PaperBrokerAdapter`. What does it actually verify right now, and what new value does it
   add the day `IBKRAdapter` exists?

_Answers: pending._
