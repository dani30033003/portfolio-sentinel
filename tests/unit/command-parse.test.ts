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
    ['status please', { command: 'unknown' }],
    ['please status', { command: 'unknown' }],
    ['', { command: 'unknown' }],
    ['hello', { command: 'unknown' }],
  ])('parses %j as %j', (input, expected) => {
    expect(parseCommand(input)).toEqual(expected);
  });
});
