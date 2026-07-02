import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiAdapter } from '../../src/adapters/llm-gemini/gemini-adapter.js';
import { LlmError } from '../../src/domain/errors.js';

const adapter = () =>
  new GeminiAdapter({ apiKey: 'test-key', model: 'gemini-test', baseUrl: 'https://fake.local' });

const geminiOk = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200,
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GeminiAdapter', () => {
  it('translates domain roles to Gemini roles (assistant → model)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiOk('ok'));
    vi.stubGlobal('fetch', fetchMock);

    await adapter().complete({
      system: 'sys',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'again' },
      ],
      maxTokens: 100,
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user']);
    expect(body.system_instruction.parts[0].text).toBe('sys');
    expect(body.generationConfig.maxOutputTokens).toBe(100);
  });

  it('targets the configured model endpoint with the API key header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiOk('ok'));
    vi.stubGlobal('fetch', fetchMock);

    await adapter().complete({ system: 's', messages: [], maxTokens: 10 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://fake.local/v1beta/models/gemini-test:generateContent');
    expect(init.headers['x-goog-api-key']).toBe('test-key');
  });

  it('returns the candidate text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geminiOk('the summary')));
    await expect(
      adapter().complete({ system: 's', messages: [], maxTokens: 10 }),
    ).resolves.toBe('the summary');
  });

  it('translates HTTP errors into LlmError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('quota exceeded', { status: 429 })),
    );
    await expect(adapter().complete({ system: 's', messages: [], maxTokens: 10 })).rejects.toThrow(
      LlmError,
    );
  });

  it('treats an empty candidate list as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [] }), { status: 200 })),
    );
    await expect(adapter().complete({ system: 's', messages: [], maxTokens: 10 })).rejects.toThrow(
      LlmError,
    );
  });

  it('translates network failures into LlmError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(adapter().complete({ system: 's', messages: [], maxTokens: 10 })).rejects.toThrow(
      LlmError,
    );
  });
});
