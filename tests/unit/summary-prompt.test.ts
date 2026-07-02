import { describe, expect, it } from 'vitest';
import { buildSummaryPrompt } from '../../src/domain/prompts/summary-prompt.js';

const snapshot = 'Equity $31,797.00 | Cash $12,400.00\nAAPL: 10 @ $150.00';

describe('buildSummaryPrompt', () => {
  it('frames output as analysis, not financial advice', () => {
    const { system } = buildSummaryPrompt({ snapshot });
    expect(system).toContain('not financial advice');
  });

  it('demands a factual, hype-free tone with uncertainty acknowledged', () => {
    const { system } = buildSummaryPrompt({ snapshot });
    expect(system).toContain('Factual tone');
    expect(system).toContain('No hype');
    expect(system.toLowerCase()).toContain('uncertainty');
  });

  it('forbids inventing numbers or news', () => {
    const { system } = buildSummaryPrompt({ snapshot });
    expect(system).toContain('never invent');
  });

  it('constrains length to WhatsApp-sized messages', () => {
    const { system } = buildSummaryPrompt({ snapshot });
    expect(system).toContain('1000 characters');
    expect(system).toContain('WhatsApp');
  });

  it('passes the full snapshot as user content, not system content', () => {
    const { system, user } = buildSummaryPrompt({ snapshot });
    expect(user).toContain(snapshot);
    expect(system).not.toContain('AAPL');
  });

  it('includes the user profile when provided, omits the section otherwise', () => {
    const withProfile = buildSummaryPrompt({ snapshot, userProfile: 'long-term investor' });
    expect(withProfile.system).toContain('long-term investor');
    const without = buildSummaryPrompt({ snapshot });
    expect(without.system).not.toContain('strategy notes');
  });
});
