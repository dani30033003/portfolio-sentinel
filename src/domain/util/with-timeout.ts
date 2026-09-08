import { TimeoutError } from '../errors.js';

/**
 * Race a promise against a deadline. Anything optional (an LLM call, say) has
 * to be bounded, so that a hung model lets the numeric fallback go out instead
 * of stalling the message entirely. The timer is always cleared so a fast win
 * doesn't leave a dangling timeout keeping the process alive.
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
