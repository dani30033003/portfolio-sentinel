import type { BrokerPort } from '../ports/broker-port.js';
import type { ClockPort } from '../ports/clock-port.js';
import type { LLMPort } from '../ports/llm-port.js';
import type {
  PortfolioSnapshot,
  StoragePort,
  SummaryKind,
} from '../ports/storage-port.js';
import { buildSummaryPrompt } from '../prompts/summary-prompt.js';
import { withTimeout } from '../util/with-timeout.js';
import { renderSnapshot } from './snapshot-text.js';
import {
  extractRecommendation,
  type ExtractedRecommendation,
} from './recommendation-extractor.js';
import { RecommendationTracker } from './recommendation-tracker.js';

export interface LlmSummaryConfig {
  readonly llm: LLMPort;
  readonly timeoutMs: number;
  /** Strategy notes injected into the prompt (user_profile, Phase 3). */
  readonly userProfile?: string;
}

export interface SummaryResult {
  readonly text: string;
  /** Which path produced the text — the caller logs fallbacks. */
  readonly source: 'llm' | 'snapshot';
  /** Set when the LLM was configured but failed and we fell back. */
  readonly llmError?: string;
  /**
   * Set when persistence was configured but failed. Like `llmError`, this is a
   * report, not a thrown error: storing the summary is secondary to sending it,
   * so a storage failure never blocks the (already-built) text. The deliverable
   * output never depends on a side channel.
   */
  readonly storageError?: string;
  /** Present when the model attached a trackable REC line (stripped from `text`). */
  readonly recommendation?: ExtractedRecommendation;
}

export class SummaryService {
  private readonly recommendations: RecommendationTracker;

  constructor(
    private readonly broker: BrokerPort,
    private readonly clock: ClockPort,
    /** IANA timezone for user-facing timestamps, e.g. "Asia/Jerusalem". */
    private readonly timeZone: string,
    /** Absent → summaries are always the deterministic numeric snapshot. */
    private readonly llmConfig?: LlmSummaryConfig,
    /** Absent → nothing is persisted (e.g. unit tests, dry runs). */
    private readonly storage?: StoragePort,
  ) {
    this.recommendations = new RecommendationTracker(storage);
  }

  /**
   * The summary to send: LLM-written when configured, but never dependent on
   * it — any LLM failure or timeout falls back to the numeric snapshot, which
   * is always computed first and always sendable. When
   * a StoragePort is configured, the snapshot and the summary are persisted
   * after the text is produced; a persistence failure is surfaced on the result
   * (`storageError`), never thrown, so it cannot block delivery.
   *
   * @param kind why this summary was produced — `scheduled` for the timed push
   *   (main.ts), `on_demand` for a SUMMARY command (webhook-main.ts).
   */
  async buildSummary(kind: SummaryKind = 'on_demand'): Promise<SummaryResult> {
    const snapshot = await this.fetchSnapshot();
    const snapshotText = renderSnapshot(snapshot, this.timeZone);

    const result = this.llmConfig
      ? await this.buildLlmSummary(this.llmConfig, snapshotText)
      : { text: snapshotText, source: 'snapshot' as const };

    if (result.recommendation) {
      await this.recommendations.record(
        result.recommendation,
        snapshot.positions,
        snapshot.takenAt,
        'summary',
      );
    }

    const storageError = await this.persist(snapshot, result.text, kind);
    return storageError === undefined ? result : { ...result, storageError };
  }

  /** Deterministic plain-text snapshot — no LLM. Also the fallback message. */
  async buildSnapshotSummary(): Promise<string> {
    return renderSnapshot(await this.fetchSnapshot(), this.timeZone);
  }

  /** One broker round-trip, timestamped once so snapshot and summary agree. */
  private async fetchSnapshot(): Promise<PortfolioSnapshot> {
    const [account, positions] = await Promise.all([
      this.broker.getAccountSummary(),
      this.broker.getPositions(),
    ]);
    return { takenAt: this.clock.now(), account, positions };
  }

  /** The LLM branch: prompt, timeout-wrapped call, fall back on any failure. */
  private async buildLlmSummary(
    llmConfig: LlmSummaryConfig,
    snapshotText: string,
  ): Promise<SummaryResult> {
    try {
      const prompt = buildSummaryPrompt({
        snapshot: snapshotText,
        ...(llmConfig.userProfile !== undefined ? { userProfile: llmConfig.userProfile } : {}),
      });
      const text = await withTimeout(
        llmConfig.llm.complete({
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
          maxTokens: 1024,
        }),
        llmConfig.timeoutMs,
        'LLM summary',
      );
      if (!text.trim()) {
        return { text: snapshotText, source: 'snapshot', llmError: 'LLM returned empty text' };
      }
      // The REC line is machine-readable tracking data, not part of the message:
      // it is stripped here and stored separately for later scoring.
      const { text: prose, recommendation } = extractRecommendation(text);
      return recommendation
        ? { text: prose, source: 'llm', recommendation }
        : { text: prose, source: 'llm' };
    } catch (error) {
      return {
        text: snapshotText,
        source: 'snapshot',
        llmError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Persist the snapshot and the summary, if storage is configured. Returns an
   * error message on failure instead of throwing — the caller has already got
   * sendable text and must not be blocked by a storage problem.
   */
  private async persist(
    snapshot: PortfolioSnapshot,
    text: string,
    kind: SummaryKind,
  ): Promise<string | undefined> {
    if (!this.storage) return undefined;
    try {
      await this.storage.saveSnapshot(snapshot);
      await this.storage.saveSummary({
        sentAt: snapshot.takenAt,
        kind,
        text,
        positionsJson: JSON.stringify(snapshot.positions),
      });
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
}

