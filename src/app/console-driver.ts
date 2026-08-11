import { createInterface } from 'node:readline';
import { parseCommand } from '../webhook/command-parser.js';
import type { Container } from './wiring.js';

export interface ConsoleDriverOptions {
  readonly container: Container;
  readonly handleCommand: (command: ReturnType<typeof parseCommand>) => Promise<string>;
  /** Runs a watchdog poll immediately, for the SHOCK/POLL demo commands. */
  readonly pollNow: () => Promise<void>;
  readonly onQuit: () => void;
}

const BANNER = [
  '',
  'Portfolio Sentinel is running. Type a command and press enter.',
  '  SUMMARY | STATUS | STATS | PAUSE | RESUME | HELP',
  '  or ask a question in plain English',
  'Demo-only commands (console, never WhatsApp):',
  '  SHOCK <SYMBOL> <PERCENT>   move a simulated price now, e.g. SHOCK NVDA -6',
  '  POLL                       run a watchdog cycle immediately',
  '  QUIT                       stop the process',
  '',
].join('\n');

/**
 * Lets the whole system be driven from a terminal, with no Meta app, no public
 * tunnel and no secrets. It reuses the same parser and the same handler as the
 * WhatsApp path, so what you exercise here is the real thing — plus two demo
 * commands that exist only because prices are simulated.
 */
export function startConsoleDriver(options: ConsoleDriverOptions): () => void {
  const { container, handleCommand, pollNow, onQuit } = options;
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });

  process.stdout.write(BANNER);
  rl.prompt();

  rl.on('line', (line) => {
    void (async () => {
      try {
        const handled = await handleDemoCommand(line, container, pollNow, onQuit);
        if (!handled) {
          const reply = await handleCommand(parseCommand(line));
          process.stdout.write(`\n${reply}\n\n`);
        }
      } catch (error) {
        container.logger.error(
          { component: 'console', err: error instanceof Error ? error.message : String(error) },
          'command failed',
        );
      }
      rl.prompt();
    })();
  });

  return () => {
    rl.close();
  };
}

/** @returns true if the line was a demo command and needs no further handling. */
async function handleDemoCommand(
  line: string,
  container: Container,
  pollNow: () => Promise<void>,
  onQuit: () => void,
): Promise<boolean> {
  const [word, ...args] = line.trim().split(/\s+/);
  const keyword = word?.toLowerCase();

  if (keyword === 'quit' || keyword === 'exit') {
    onQuit();
    return true;
  }

  if (keyword === 'poll') {
    await pollNow();
    return true;
  }

  if (keyword === 'shock') {
    const [symbol, percent] = args;
    const fraction = Number(percent) / 100;
    if (!symbol || !Number.isFinite(fraction)) {
      process.stdout.write('\nUsage: SHOCK <SYMBOL> <PERCENT>, e.g. SHOCK NVDA -6\n\n');
      return true;
    }
    container.broker.simulator.shock(symbol.toUpperCase(), fraction);
    process.stdout.write(`\nMoved ${symbol.toUpperCase()} by ${percent}%. Polling...\n`);
    await pollNow();
    return true;
  }

  return false;
}
