import Anthropic from '@anthropic-ai/sdk';
import type { CompletionRequest, LLMPort } from '../../domain/ports/llm-port.js';
import { LlmError } from '../../domain/errors.js';

export interface AnthropicConfig {
  apiKey: string;
  /** e.g. "claude-sonnet-4-6" — always from config, never hardcoded upstream. */
  model: string;
  timeoutMs?: number;
}

export class AnthropicAdapter implements LLMPort {
  private readonly client: Anthropic;

  constructor(private readonly config: AnthropicConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      timeout: config.timeoutMs ?? 30_000, // SDK timeout is in milliseconds
      maxRetries: 1,
    });
  }

  async complete(req: CompletionRequest): Promise<string> {
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      });
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new LlmError(`Anthropic API error ${error.status}: ${error.message}`);
      }
      throw new LlmError(
        `Anthropic request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    if (!text) {
      throw new LlmError(`Anthropic returned no text (stop_reason: ${response.stop_reason})`);
    }
    return text;
  }
}
