/**
 * Every domain read of "now" goes through this port so tests can control time.
 * Never call `new Date()` or `Date.now()` inside src/domain/.
 */
export interface ClockPort {
  now(): Date;
}
