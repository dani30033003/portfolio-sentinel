import type { ClockPort } from '../../domain/ports/clock-port.js';

/**
 * Deterministic price engine behind PaperBrokerAdapter. Two jobs it has to do
 * at once: produce prices that actually move (a watchdog with frozen prices
 * proves nothing) while staying reproducible (a test that asserts "an alert
 * fires" must not depend on luck). Both come from the same trick: prices are a
 * pure function of (seed, number of ticks elapsed), never of wall-clock jitter.
 */
export interface SimulatorConfig {
  /** Same seed + same tick count ⇒ same prices, on any machine. */
  readonly seed: number;
  /** Wall-clock milliseconds per simulated price tick. */
  readonly tickMs: number;
  /** Max fractional move per tick, e.g. 0.004 = ±0.4%. */
  readonly volatility: number;
  /** Per-tick drift added to the random move; 0 = no trend. */
  readonly drift: number;
}

export const DEFAULT_SIMULATOR_CONFIG: SimulatorConfig = {
  seed: 1,
  tickMs: 5_000,
  volatility: 0.004,
  drift: 0,
};

/**
 * mulberry32: a 32-bit PRNG in four lines. Chosen over Math.random() for the
 * one property that matters here — it is seedable, so a test can replay the
 * exact price path that produced a trigger. Not cryptographic; never use this
 * where unpredictability is a security property.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MarketSimulator {
  private readonly config: SimulatorConfig;
  private readonly random: () => number;
  private readonly openPrices = new Map<string, number>();
  private readonly prices = new Map<string, number>();
  private lastTickAt: number;

  /**
   * @param initialPrices starting price per symbol, in integer cents.
   */
  constructor(
    initialPrices: ReadonlyMap<string, number>,
    private readonly clock: ClockPort,
    config: Partial<SimulatorConfig> = {},
  ) {
    this.config = { ...DEFAULT_SIMULATOR_CONFIG, ...config };
    this.random = mulberry32(this.config.seed);
    for (const [symbol, price] of initialPrices) {
      this.prices.set(symbol, price);
      this.openPrices.set(symbol, price);
    }
    this.lastTickAt = this.clock.now().getTime();
  }

  /**
   * All current prices in integer cents, advanced to "now" exactly once.
   * Callers that need several symbols must use this rather than repeated
   * priceOf() calls: a tick boundary crossed mid-loop would otherwise hand
   * out pre-tick and post-tick prices inside one logical snapshot.
   */
  currentPrices(): ReadonlyMap<string, number> {
    this.advance();
    return this.prices;
  }

  /** Current price in integer cents, advancing the walk to "now" first. */
  priceOf(symbol: string): number {
    return this.currentPrices().get(symbol) ?? 0;
  }

  /** The session's opening price, for day-P&L. Never moves. */
  openPriceOf(symbol: string): number {
    return this.openPrices.get(symbol) ?? 0;
  }

  /**
   * Force an immediate move, e.g. `shock('NVDA', -0.06)` for −6%. The demo
   * lever: it makes the watchdog fire on command instead of on patience.
   */
  shock(symbol: string, fraction: number): void {
    this.advance();
    const current = this.prices.get(symbol);
    if (current === undefined) return;
    this.prices.set(symbol, clampCents(current * (1 + fraction)));
  }

  symbols(): string[] {
    return [...this.prices.keys()];
  }

  /**
   * Steps the walk forward by however many whole ticks have elapsed. Whole
   * ticks only: the tick count — not the elapsed milliseconds — is what the
   * price path depends on, which is what keeps a run reproducible even though
   * real timers fire late.
   */
  private advance(): void {
    const now = this.clock.now().getTime();
    const ticks = Math.floor((now - this.lastTickAt) / this.config.tickMs);
    if (ticks <= 0) return;
    this.lastTickAt += ticks * this.config.tickMs;

    for (let i = 0; i < ticks; i += 1) {
      for (const [symbol, price] of this.prices) {
        const move = (this.random() * 2 - 1) * this.config.volatility + this.config.drift;
        this.prices.set(symbol, clampCents(price * (1 + move)));
      }
    }
  }
}

/** Prices stay integer cents and never reach zero (a 0 price breaks % math). */
function clampCents(value: number): number {
  return Math.max(1, Math.round(value));
}
