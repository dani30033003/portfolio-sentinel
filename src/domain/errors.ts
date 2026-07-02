/**
 * Base class for all typed domain errors (CLAUDE.md: never throw raw strings).
 * Adapters translate SDK/transport errors into these at the boundary.
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidMoneyError extends DomainError {}

export class CurrencyMismatchError extends DomainError {}

/** Thrown by messaging adapters when an outbound send fails. */
export class MessageSendError extends DomainError {}

/** Thrown by LLM adapters when a completion fails (API error, empty response...). */
export class LlmError extends DomainError {}

/** Thrown by withTimeout when the wrapped promise does not settle in time. */
export class TimeoutError extends DomainError {}

/** Placeholder thrown by human-owned module stubs that are not implemented yet. */
export class NotImplementedError extends DomainError {}
