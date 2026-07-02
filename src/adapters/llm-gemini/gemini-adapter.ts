import type { CompletionRequest, LLMPort } from '../../domain/ports/llm-port.js';
import { LlmError } from '../../domain/errors.js';

export interface GeminiConfig {
  apiKey: string;
  /** e.g. "gemini-2.5-flash" — always from config, never hardcoded upstream. */
  model: string;
  timeoutMs?: number;
  /** Overridable for tests; defaults to Google's endpoint. */
  baseUrl?: string;
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
  }[];
}

/**
 * Google Gemini adapter via the generateContent REST endpoint — one POST, no
 * SDK. Gemini's wire format differs from the domain's ChatMessage shape
 * (role "model" instead of "assistant", parts arrays instead of strings);
 * that translation lives entirely here.
 */
export class GeminiAdapter implements LLMPort {
  private readonly url: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: GeminiConfig) {
    const base = config.baseUrl ?? 'https://generativelanguage.googleapis.com';
    this.url = `${base}/v1beta/models/${config.model}:generateContent`;
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  async complete(req: CompletionRequest): Promise<string> {
    let response: Response;
    try {
      response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'x-goog-api-key': this.config.apiKey,
          'content-type': 'application/json',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          system_instruction: { parts: [{ text: req.system }] },
          contents: req.messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          generationConfig: { maxOutputTokens: req.maxTokens },
        }),
      });
    } catch (error) {
      throw new LlmError(
        `Gemini request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '<unreadable body>');
      throw new LlmError(`Gemini API error ${response.status}: ${detail}`);
    }

    const data = (await response.json()) as GeminiResponse;
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('');
    if (!text) {
      throw new LlmError('Gemini returned no text');
    }
    return text;
  }
}
