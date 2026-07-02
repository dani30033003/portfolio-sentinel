import { TimeoutError } from '../errors.js';

/**
 * Race a promise against a deadline. Enforces CLAUDE.md hard rule 6: anything
 * optional (like an LLM call) must be bounded so the numeric fallback can go
 * out instead. The timer is always cleared so a fast win doesn't leave a
 * dangling timeout keeping the process alive.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
