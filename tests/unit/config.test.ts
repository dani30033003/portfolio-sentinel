import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/app/config.js';

describe('loadConfig — LLM selection', () => {
  it('defaults to provider none when no keys are set', () => {
    expect(loadConfig({}).llm).toEqual({ provider: 'none' });
  });

  it('infers anthropic from ANTHROPIC_API_KEY', () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: 'k' });
    expect(config.llm).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
  });

  it('infers gemini from GEMINI_API_KEY', () => {
    const config = loadConfig({ GEMINI_API_KEY: 'k' });
    expect(config.llm).toMatchObject({ provider: 'gemini', model: 'gemini-2.5-flash' });
  });

  it('prefers anthropic when both keys are present', () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' });
    expect(config.llm).toMatchObject({ provider: 'anthropic' });
  });

  it('lets an explicit LLM_PROVIDER override inference', () => {
    const config = loadConfig({
      LLM_PROVIDER: 'gemini',
      ANTHROPIC_API_KEY: 'a',
      GEMINI_API_KEY: 'g',
    });
    expect(config.llm).toMatchObject({ provider: 'gemini' });
  });

  it('rejects an explicit provider without its API key', () => {
    expect(() => loadConfig({ LLM_PROVIDER: 'anthropic' })).toThrow(ConfigError);
    expect(() => loadConfig({ LLM_PROVIDER: 'gemini' })).toThrow(ConfigError);
  });

  it('rejects an unknown provider', () => {
    expect(() => loadConfig({ LLM_PROVIDER: 'openai' })).toThrow(ConfigError);
  });

  it('honors model and timeout overrides', () => {
    const config = loadConfig({
      ANTHROPIC_API_KEY: 'k',
      ANTHROPIC_MODEL: 'claude-sonnet-5',
      LLM_TIMEOUT_MS: '5000',
    });
    expect(config.llm).toMatchObject({ model: 'claude-sonnet-5', timeoutMs: 5000 });
  });

  it('rejects a non-numeric timeout', () => {
    expect(() => loadConfig({ LLM_TIMEOUT_MS: 'fast' })).toThrow(ConfigError);
  });
});

describe('loadConfig — webhook', () => {
  it('leaves webhook undefined when neither var is set', () => {
    expect(loadConfig({}).webhook).toBeUndefined();
  });

  it('builds webhook config with the default port when both vars are set', () => {
    const config = loadConfig({
      WHATSAPP_VERIFY_TOKEN: 'v',
      WHATSAPP_APP_SECRET: 's',
    });
    expect(config.webhook).toEqual({ verifyToken: 'v', appSecret: 's', port: 3000 });
  });

  it('honors a WEBHOOK_PORT override', () => {
    const config = loadConfig({
      WHATSAPP_VERIFY_TOKEN: 'v',
      WHATSAPP_APP_SECRET: 's',
      WEBHOOK_PORT: '8080',
    });
    expect(config.webhook).toMatchObject({ port: 8080 });
  });

  it('rejects a verify token without an app secret', () => {
    expect(() => loadConfig({ WHATSAPP_VERIFY_TOKEN: 'v' })).toThrow(ConfigError);
  });

  it('rejects an app secret without a verify token', () => {
    expect(() => loadConfig({ WHATSAPP_APP_SECRET: 's' })).toThrow(ConfigError);
  });

  it('rejects a non-numeric WEBHOOK_PORT', () => {
    expect(() =>
      loadConfig({ WHATSAPP_VERIFY_TOKEN: 'v', WHATSAPP_APP_SECRET: 's', WEBHOOK_PORT: 'nope' }),
    ).toThrow(ConfigError);
  });
});

describe('loadConfig — storage', () => {
  it('defaults dbPath when DB_PATH is unset', () => {
    expect(loadConfig({}).dbPath).toBe('./data/portfolio-sentinel.db');
  });

  it('honors a DB_PATH override', () => {
    expect(loadConfig({ DB_PATH: '/var/lib/sentinel.db' }).dbPath).toBe('/var/lib/sentinel.db');
  });
});
