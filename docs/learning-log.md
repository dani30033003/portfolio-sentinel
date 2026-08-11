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

## Phase 1 — read-only summaries, storage, commands

1. `SummaryService.buildSummary` computes the numeric snapshot *before* it ever calls the
   LLM, even when an LLM is configured and will almost certainly succeed. Why that order?
   What breaks if you build the text lazily only when the LLM fails?
2. A storage failure comes back as `result.storageError` instead of being thrown. Describe a
   concrete Tuesday where that choice is the difference between a good and a bad outcome.
3. `SqliteStorageAdapter` is fully synchronous inside, but `StoragePort` returns Promises.
   Who benefits from that mismatch, and what would have to change if the store became a
   network database tomorrow?
4. The webhook parses the raw request body as a `Buffer` and verifies the HMAC before
   `JSON.parse`. Why can't we parse first and verify after?
5. `startOfDayInZone` exists so the daily alert cap resets at the user's midnight, not UTC's.
   Given the user is in Asia/Jerusalem, describe the specific abuse window that a UTC-based
   reset would open.

_Answers: pending._

## Phase 2 — watchdog and alerts

1. `evaluatePositionDrops` measures the drop from the *peak* inside the rolling window, not
   from the window's first price. Give an example where those two answers differ, and say
   which one you actually want to be woken up for.
2. Cooldown state lives in memory (`AlertPolicyState`) but the daily cap is counted from
   storage. Both are "how much have I already said?" — why does one survive a restart and
   the other deliberately does not?
3. `decideAlert` checks `paused` before it checks the daily cap. Does the order matter? What
   user-visible bug appears if you swap those two checks?
4. A single poll can produce several triggers. `WatchdogService` tracks `budgetUsed` inside
   the loop rather than re-reading the count from storage. What goes wrong without it?
5. The watchdog announces a dead broker session only after `gatewayDownAfterMs`, and
   announces recovery too. Why is the recovery message not optional, given the tool's job?

## Phase 3 — chat, recommendations, MCP

1. The user's message never appears in the system prompt — only as user-role content. Walk
   through what an attacker (or a careless message) could do if that rule were relaxed.
2. Recommendations are extracted by a regex in code rather than by a second LLM call. What
   does that buy, and what is the failure mode you accepted in exchange?
3. `RecommendationTracker.record` silently drops a recommendation about a symbol with no
   current price. Argue both sides: why is dropping better than storing it with a zero price?
4. `StatusService.renderStats` excludes `hold` and `watch` from the hit-rate denominator
   entirely. What would the number look like if they were counted as misses, and why would
   that be dishonest?
5. The MCP server points pino at stderr. What exactly breaks if it logs to stdout, and why
   does the WhatsApp path not have this problem?

_Answers: pending._
