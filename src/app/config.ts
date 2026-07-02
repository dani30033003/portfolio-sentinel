import type { PhoneNumber } from '../domain/ports/messaging-port.js';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export type LlmConfig =
  | { provider: 'anthropic'; apiKey: string; model: string; timeoutMs: number }
  | { provider: 'gemini'; apiKey: string; model: string; timeoutMs: number }
  | { provider: 'none' };

export interface AppConfig {
  /** IANA timezone for user-facing timestamps. Storage stays UTC. */
  timeZone: string;
  /** Absent → dry-run mode: messages print to the console. */
  whatsapp?: { token: string; phoneNumberId: string; to: PhoneNumber };
  /** provider "none" → summaries stay deterministic (numeric snapshot). */
  llm: LlmConfig;
}

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_LLM_TIMEOUT_MS = 30_000;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const timeZone = env.USER_TIMEZONE ?? 'Asia/Jerusalem';

  const token = env.WHATSAPP_TOKEN;
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
  const to = env.WHATSAPP_TO;

  let whatsapp: AppConfig['whatsapp'];
  if (token && phoneNumberId && to) {
    whatsapp = { token, phoneNumberId, to };
  } else if (token || phoneNumberId || to) {
    throw new ConfigError(
      'Partial WhatsApp config: set all of WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, ' +
        'WHATSAPP_TO — or none of them for console dry-run mode.',
    );
  }

  const llm = loadLlmConfig(env);

  return whatsapp ? { timeZone, whatsapp, llm } : { timeZone, llm };
}

function loadLlmConfig(env: NodeJS.ProcessEnv): LlmConfig {
  const timeoutMs = env.LLM_TIMEOUT_MS ? Number(env.LLM_TIMEOUT_MS) : DEFAULT_LLM_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ConfigError(`LLM_TIMEOUT_MS must be a positive number, got "${env.LLM_TIMEOUT_MS}"`);
  }

  // Explicit provider wins; otherwise infer from which API key is present.
  const provider =
    env.LLM_PROVIDER ?? (env.ANTHROPIC_API_KEY ? 'anthropic' : env.GEMINI_API_KEY ? 'gemini' : 'none');

  switch (provider) {
    case 'anthropic': {
      if (!env.ANTHROPIC_API_KEY) {
        throw new ConfigError('LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY to be set.');
      }
      return {
        provider: 'anthropic',
        apiKey: env.ANTHROPIC_API_KEY,
        model: env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL,
        timeoutMs,
      };
    }
    case 'gemini': {
      if (!env.GEMINI_API_KEY) {
        throw new ConfigError('LLM_PROVIDER=gemini requires GEMINI_API_KEY to be set.');
      }
      return {
        provider: 'gemini',
        apiKey: env.GEMINI_API_KEY,
        model: env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
        timeoutMs,
      };
    }
    case 'none':
      return { provider: 'none' };
    default:
      throw new ConfigError(
        `Unknown LLM_PROVIDER "${provider}" — expected anthropic, gemini, or none.`,
      );
  }
}
