import type { BrokerPort } from '../ports/broker-port.js';
import type { ClockPort } from '../ports/clock-port.js';
import type { ChatMessage } from '../ports/llm-port.js';
import type { StoragePort } from '../ports/storage-port.js';
import { buildQuerySystemPrompt } from '../prompts/query-prompt.js';
import { withTimeout } from '../util/with-timeout.js';
import { formatInZone } from '../util/time.js';
import { renderSnapshot } from './snapshot-text.js';
import { extractRecommendation } from './recommendation-extractor.js';
import { RecommendationTracker } from './recommendation-tracker.js';
import type { LlmSummaryConfig } from './summary-service.js';

export interface QueryResult {
  readonly text: string;
  readonly source: 'llm' | 'snapshot';
  readonly llmError?: string;
}

/** How many past turns travel with each question. Cost and drift both grow with it. */
const CONVERSATION_WINDOW = 10;
const RECENT_ALERTS_IN_CONTEXT = 5;

/**
 * The chat path: free text in, grounded answer out. Every answer is built on a
 * snapshot taken at question time, so the model is never reasoning about stale
 * prices, and the user's text is passed as user-role content only.
 */
export class QueryService {
  private readonly recommendations: RecommendationTracker;

  constructor(
    private readonly broker: BrokerPort,
    private readonly clock: ClockPort,
    private readonly timeZone: string,
    private readonly llmConfig?: LlmSummaryConfig,
    private readonly storage?: StoragePort,
  ) {
    this.recommendations = new RecommendationTracker(storage);
  }

  async answer(question: string): Promise<QueryResult> {
    const now = this.clock.now();
    const [account, positions] = await Promise.all([
      this.broker.getAccountSummary(),
      this.broker.getPositions(),
    ]);
    const snapshotText = renderSnapshot({ takenAt: now, account, positions }, this.timeZone);

    if (!this.llmConfig) {
      return {
        text:
          'Chat needs an LLM provider configured (ANTHROPIC_API_KEY or GEMINI_API_KEY). ' +
          `Here is the current portfolio instead:\n\n${snapshotText}`,
        source: 'snapshot',
      };
    }

    const history = await this.loadHistory();
    const recentAlerts = await this.loadRecentAlerts();

    try {
      const system = buildQuerySystemPrompt({
        snapshot: snapshotText,
        recentAlerts,
        ...(this.llmConfig.userProfile !== undefined
          ? { userProfile: this.llmConfig.userProfile }
          : {}),
      });
      const raw = await withTimeout(
        this.llmConfig.llm.complete({
          system,
          messages: [...history, { role: 'user', content: question }],
          maxTokens: 700,
        }),
        this.llmConfig.timeoutMs,
        'LLM query',
      );

      if (!raw.trim()) {
        return {
          text: `I could not produce an answer. Current portfolio:\n\n${snapshotText}`,
          source: 'snapshot',
          llmError: 'LLM returned empty text',
        };
      }

      const { text, recommendation } = extractRecommendation(raw);
      await this.persist(question, text, now);
      if (recommendation) {
        await this.recommendations.record(recommendation, positions, now, 'chat');
      }
      return { text, source: 'llm' };
    } catch (error) {
      // Same contract as summaries and alerts: the user always gets something
      // real back, even when the model is the part that is broken.
      return {
        text:
          'I could not reach the language model, so here is the raw portfolio ' +
          `as of ${formatInZone(now, this.timeZone)}:\n\n${snapshotText}`,
        source: 'snapshot',
        llmError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async loadHistory(): Promise<ChatMessage[]> {
    if (!this.storage) return [];
    try {
      const turns = await this.storage.getRecentConversation(CONVERSATION_WINDOW);
      return turns.map((turn) => ({ role: turn.role, content: turn.text }));
    } catch {
      return [];
    }
  }

  private async loadRecentAlerts(): Promise<string[]> {
    if (!this.storage) return [];
    try {
      const alerts = await this.storage.getRecentAlerts(RECENT_ALERTS_IN_CONTEXT);
      return alerts.map((alert) => `${formatInZone(alert.firedAt, this.timeZone)}: ${alert.text}`);
    } catch {
      return [];
    }
  }

  /** Conversation memory is best-effort: losing it must never lose the answer. */
  private async persist(question: string, answer: string, at: Date): Promise<void> {
    if (!this.storage) return;
    try {
      await this.storage.appendConversationTurn({ at, role: 'user', text: question });
      await this.storage.appendConversationTurn({ at, role: 'assistant', text: answer });
    } catch {
      // ignored on purpose — see method comment
    }
  }

}
