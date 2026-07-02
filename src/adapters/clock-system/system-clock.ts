import type { ClockPort } from '../../domain/ports/clock-port.js';

/** The one place outside tests where "now" is read from the real system clock. */
export class SystemClock implements ClockPort {
  now(): Date {
    return new Date();
  }
}
