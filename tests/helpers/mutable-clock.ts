import type { ClockPort } from '../../src/domain/ports/clock-port.js';

/** A ClockPort tests can drive forward, so time-dependent logic runs instantly. */
export class MutableClock implements ClockPort {
  constructor(private current: Date = new Date('2026-07-02T12:00:00Z')) {}

  now(): Date {
    return this.current;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  set(date: Date): void {
    this.current = date;
  }
}
