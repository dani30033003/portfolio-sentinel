import type { PhoneNumber } from '../domain/ports/messaging-port.js';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface AppConfig {
  /** IANA timezone for user-facing timestamps. Storage stays UTC. */
  timeZone: string;
  /** Absent → dry-run mode: messages print to the console. */
  whatsapp?: { token: string; phoneNumberId: string; to: PhoneNumber };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const timeZone = env.USER_TIMEZONE ?? 'Asia/Jerusalem';

  const token = env.WHATSAPP_TOKEN;
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
  const to = env.WHATSAPP_TO;

  if (token && phoneNumberId && to) {
    return { timeZone, whatsapp: { token, phoneNumberId, to } };
  }

  if (token || phoneNumberId || to) {
    throw new ConfigError(
      'Partial WhatsApp config: set all of WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, ' +
        'WHATSAPP_TO — or none of them for console dry-run mode.',
    );
  }

  return { timeZone };
}
