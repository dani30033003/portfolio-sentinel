/**
 * Exercises the real composition root: real config loading, real SQLite (in
 * memory), real paper broker, real command handler. Unit tests prove each part
 * in isolation; this proves they are actually plugged together — the failure
 * mode where every test passes and `npm run dev` still does nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildContainer, type Container } from '../../src/app/wiring.js';
import { createCommandHandler } from '../../src/app/command-handler.js';
import { WatchdogService } from '../../src/domain/services/watchdog-service.js';
import { parseCommand } from '../../src/webhook/command-parser.js';

const ENV_KEYS = ['DB_PATH', 'LLM_PROVIDER', 'WHATSAPP_TOKEN', 'SIM_VOLATILITY'] as const;

describe('sentinel wiring', () => {
  let container: Container;
  let handle: ReturnType<typeof createCommandHandler>;
  const originalEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of ENV_KEYS) originalEnv.set(key, process.env[key]);
    process.env.DB_PATH = ':memory:';
    process.env.LLM_PROVIDER = 'none';
    delete process.env.WHATSAPP_TOKEN;

    container = buildContainer('test');
    handle = createCommandHandler(container);
  });

  afterEach(() => {
    container.close();
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('answers SUMMARY with live numbers and persists what it sent', async () => {
    const reply = await handle(parseCommand('SUMMARY'));

    expect(reply).toContain('Portfolio snapshot');
    expect(reply).toContain('NVDA');

    const stored = await container.storage.getRecentSummaries(1);
    expect(stored[0]?.kind).toBe('on_demand');
    expect(stored[0]?.text).toBe(reply);
  });

  it('answers STATUS from real state, and STATUS reflects a poll happening', async () => {
    expect(await handle(parseCommand('STATUS'))).toContain('Last poll: never');

    await container.watchdog.poll();

    const after = await handle(parseCommand('STATUS'));
    expect(after).toContain('Broker: connected');
    expect(after).not.toContain('Last poll: never');
  });

  it('toggles the kill switch through the same commands WhatsApp would send', async () => {
    expect(await handle(parseCommand('PAUSE'))).toContain('paused');
    expect(container.state.paused).toBe(true);
    expect(await handle(parseCommand('PAUSE'))).toContain('already paused');
    expect(await handle(parseCommand('RESUME'))).toContain('resumed');
    expect(container.state.paused).toBe(false);
  });

  it('falls back to the raw snapshot for questions when no LLM is configured', async () => {
    const reply = await handle(parseCommand('what is my biggest position?'));
    expect(reply).toContain('Chat needs an LLM provider configured');
    expect(reply).toContain('Equity');
  });

  it('delivers an alert end to end when a simulated price drops', async () => {
    // The container's own watchdog would print through the console messaging
    // adapter; this one shares every other real dependency with it and only
    // swaps the transport, so the assertion can read what was sent.
    const sent: string[] = [];
    const watchdog = new WatchdogService(
      container.broker,
      container.clock,
      { sendMessage: async (_to, text) => void sent.push(text) },
      'test',
      container.state,
      { timeZone: container.config.timeZone },
      undefined,
      container.storage,
    );

    await watchdog.poll();
    container.broker.simulator.shock('NVDA', -0.09);
    const result = await watchdog.poll();

    expect(result.sent.length).toBeGreaterThan(0);
    expect(sent.some((text) => text.includes('ALERT NVDA'))).toBe(true);
    expect(await container.storage.getRecentAlerts(5)).not.toHaveLength(0);
  });
});
