import { describe, expect, it } from 'vitest';
import { parseCommand, type Command } from '../../src/webhook/command-parser.js';

describe('parseCommand', () => {
  it.each<[string, Command]>([
    ['status', { command: 'status' }],
    ['STATUS', { command: 'status' }],
    ['  Status  ', { command: 'status' }],
    ['summary', { command: 'summary' }],
    ['SUMMARY', { command: 'summary' }],
    ['  Summary  ', { command: 'summary' }],
    ['pause', { command: 'pause' }],
    ['RESUME', { command: 'resume' }],
    ['stats', { command: 'stats' }],
    ['help', { command: 'help' }],
    ['', { command: 'unknown' }],
    ['   ', { command: 'unknown' }],
  ])('parses %j as %j', (input, expected) => {
    expect(parseCommand(input)).toEqual(expected);
  });

  it('treats anything that is not an exact command as a question', () => {
    expect(parseCommand('how is my portfolio doing?')).toEqual({
      command: 'question',
      text: 'how is my portfolio doing?',
    });
  });

  it('does not let a command word buried in a sentence trigger the command', () => {
    // Exact match only: "status please" is a question, not a STATUS command.
    expect(parseCommand('status please')).toEqual({
      command: 'question',
      text: 'status please',
    });
  });

  it('keeps question text verbatim apart from surrounding whitespace', () => {
    expect(parseCommand('  Why did NVDA drop?  ')).toEqual({
      command: 'question',
      text: 'Why did NVDA drop?',
    });
  });
});
