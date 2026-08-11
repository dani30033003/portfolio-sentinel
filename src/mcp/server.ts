/**
 * MCP entry point: the same domain services, exposed to an MCP client
 * (Claude Desktop/Code) over stdio. No duplicated logic — this file is a
 * transport, exactly like the WhatsApp webhook is.
 *
 * Read-only by construction: there is no tool here that can place an order,
 * and BrokerPort has no order methods to call even if there were (Phase 4
 * adds proposals, which still require a human confirmation elsewhere).
 *
 * stdio note: an MCP server speaks JSON-RPC over stdout, so nothing else may
 * ever write there. Logging goes to stderr, and the container's pino logger is
 * pointed at stderr below for that reason.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { destination } from 'pino';
import { z } from 'zod';
import { buildContainer, loadEnvFile } from '../app/wiring.js';
import { renderSnapshot } from '../domain/services/snapshot-text.js';
import { formatMoney } from '../domain/entities/money-math.js';
import { formatInZone } from '../domain/util/time.js';

loadEnvFile();

const container = buildContainer('portfolio-sentinel-mcp', destination(2));
const { broker, clock, storage, config } = container;

const server = new McpServer({ name: 'portfolio-sentinel', version: '0.1.0' });

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });

server.registerTool(
  'get_account_summary',
  {
    title: 'Get account summary',
    description: 'Equity, cash and day P&L for the monitored brokerage account.',
  },
  async () => {
    const account = await broker.getAccountSummary();
    return text(
      `Equity ${formatMoney(account.equity)}\n` +
        `Cash ${formatMoney(account.cash)}\n` +
        `Day P&L ${formatMoney(account.dayPnl, { withSign: true })}`,
    );
  },
);

server.registerTool(
  'get_positions',
  {
    title: 'Get positions',
    description: 'All open positions with quantity, average cost, price and unrealized P&L.',
  },
  async () => {
    const [account, positions] = await Promise.all([
      broker.getAccountSummary(),
      broker.getPositions(),
    ]);
    return text(
      renderSnapshot({ takenAt: clock.now(), account, positions }, config.timeZone),
    );
  },
);

server.registerTool(
  'get_quotes',
  {
    title: 'Get quotes',
    description: 'Current price for the given symbols (only symbols held in the account).',
    inputSchema: { symbols: z.array(z.string()).min(1) },
  },
  async ({ symbols }) => {
    const quotes = await broker.getQuotes(symbols.map((s) => s.toUpperCase()));
    if (quotes.length === 0) return text('No quotes available for those symbols.');
    return text(quotes.map((q) => `${q.symbol}: ${formatMoney(q.price)}`).join('\n'));
  },
);

server.registerTool(
  'get_recent_alerts',
  {
    title: 'Get recent alerts',
    description: 'Watchdog alerts that were delivered, most recent first.',
    inputSchema: { limit: z.number().int().min(1).max(50).default(10) },
  },
  async ({ limit }) => {
    const alerts = await storage.getRecentAlerts(limit);
    if (alerts.length === 0) return text('No alerts have fired.');
    return text(
      alerts
        .map(
          (alert) =>
            `${formatInZone(alert.firedAt, config.timeZone)} [${alert.ruleId}] ${alert.text}`,
        )
        .join('\n'),
    );
  },
);

server.registerTool(
  'get_recent_summaries',
  {
    title: 'Get recent summaries',
    description: 'Portfolio summaries that were sent, most recent first.',
    inputSchema: { limit: z.number().int().min(1).max(20).default(5) },
  },
  async ({ limit }) => {
    const summaries = await storage.getRecentSummaries(limit);
    if (summaries.length === 0) return text('No summaries recorded yet.');
    return text(
      summaries
        .map((s) => `${formatInZone(s.sentAt, config.timeZone)} (${s.kind})\n${s.text}`)
        .join('\n\n'),
    );
  },
);

server.registerTool(
  'get_recommendations',
  {
    title: 'Get recommendation history',
    description:
      'Recommendations the assistant has made, with the price at the time and how they ' +
      'scored at 1d/7d/30d where those horizons have elapsed.',
    inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
  },
  async ({ limit }) => {
    const recommendations = await storage.getRecentRecommendations(limit);
    if (recommendations.length === 0) return text('No recommendations recorded yet.');
    return text(
      recommendations
        .map((r) => {
          const scores = Object.entries(r.scores)
            .map(([horizon, value]) => `${horizon} ${value >= 0 ? '+' : ''}${value.toFixed(1)}%`)
            .join(', ');
          return (
            `${formatInZone(r.madeAt, config.timeZone)} ${r.symbol} ${r.direction} at ` +
            `${formatMoney({ amountCents: r.priceCents, currency: r.currency })} ` +
            `(${r.source}): ${r.rationale}${scores ? ` — ${scores}` : ''}`
          );
        })
        .join('\n'),
    );
  },
);

server.registerTool(
  'get_status',
  { title: 'Get system status', description: 'Health of the sentinel process itself.' },
  async () => text(await container.status.renderStatus()),
);

process.once('SIGINT', () => {
  container.close();
  process.exit(0);
});

await server.connect(new StdioServerTransport());
