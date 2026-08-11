/**
 * Timestamps live in UTC everywhere in this system; a timezone is applied only
 * here, at the presentation edge, and for deciding when the user's day starts.
 */
export function formatInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/**
 * Midnight of `now`'s calendar day in `timeZone`, as a UTC instant. Backs the
 * daily alert cap, which is a promise about the user's day, not about UTC's —
 * in Asia/Jerusalem those differ by two or three hours, which is exactly the
 * window in which an evening alert storm would otherwise get a fresh budget.
 *
 * Computed by subtracting the local wall-clock time-of-day from `now`. That is
 * off by an hour on the two days a year a DST shift falls inside the elapsed
 * span — acceptable for a rate limit, and never for money or ordering.
 */
export function startOfDayInZone(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const valueOf = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  const elapsedMs =
    valueOf('hour') * 3_600_000 +
    valueOf('minute') * 60_000 +
    valueOf('second') * 1_000 +
    now.getMilliseconds();

  return new Date(now.getTime() - elapsedMs);
}

/** "3h 12m" / "45s" — for STATUS uptime and "last seen" lines. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
