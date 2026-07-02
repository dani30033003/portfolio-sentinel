/**
 * Provider-agnostic LLM port. Deliberately minimal: plain strings in, plain
 * string out. Provider specifics (Anthropic content blocks, Gemini parts/roles)
 * are translated inside adapters and never leak into the domain.
 */
export interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface CompletionRequest {
  readonly system: string;
  readonly messages: ChatMessage[];
  readonly maxTokens: number;
}

export interface LLMPort {
  /** Returns the model's text response. Throws LlmError on any failure. */
  complete(req: CompletionRequest): Promise<string>;
}
