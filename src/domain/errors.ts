/**
 * Base class for all typed domain errors; raw strings are never thrown.
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

/** Thrown by storage adapters when a read or write fails (disk, corruption...). */
export class StorageError extends DomainError {}

/** Thrown by a stub that has a signature and tests but no implementation yet. */
export class NotImplementedError extends DomainError {}
