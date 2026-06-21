#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * cli.ts — CLI dispatcher for roblox-mcp-difz
 *
 * Commands:
 *   roblox-mcp-difz              → show help
 *   roblox-mcp-difz start        → start HTTP server
 *   roblox-mcp-difz start:stdio  → start stdio MCP transport (official SDK)
 *   roblox-mcp-difz setup        → interactive setup wizard
 *   roblox-mcp-difz setup --ai <name> → auto-setup for specific AI
 */
const path = require('path');
const readline = require('readline');
function printBanner(port, toolsCount, mode, wsCount) {
    console.log(``);
    console.log(`Roblox MCP Server v1.1.4`);
    console.log(`  HTTP:  http://localhost:${port}/mcp`);
    console.log(`  WS:    ws://localhost:${port}/ws`);
    console.log(`  Info:  http://localhost:${port}/type`);
    console.log(`  Tools: ${toolsCount} registered`);
    console.log(`  Mode:  ${mode}`);
    console.log(``);
}
async function cmdStart(stdioMode) {
    const PORT = parseInt(process.env.MCP_PORT, 10) || 28429;
    if (stdioMode) {
        // In stdio mode, use the official MCP SDK StdioServerTransport
        const { createMcpServerDeps } = require('./server-core');
        const { initMcpServer, StdioServerTransport } = require('./mcp-server');
        const { queue, tools, sessions, proc } = createMcpServerDeps();
        const server = initMcpServer(queue, tools, sessions, proc);
        const transport = new StdioServerTransport();
        await server.connect(transport);
        // Keep running
        await new Promise(() => { });
        return;
    }
    // HTTP mode: express + ws bridge + sse endpoint
    const { createApp } = require('./server-core');
    const { app, server, tools, mcp, wss } = createApp({ stdio: false });
    server.listen(PORT, () => {
        const mode = 'HTTP + WS';
        printBanner(PORT, tools.count, mode, wss ? wss.connectedCount : 0);
    });
}
async function cmdSetup(targetAI, transport) {
    const { runSetupWizard } = require('./setup');
    await runSetupWizard(targetAI, transport);
}
function cmdHelp() {
    console.log(`
Usage: roblox-mcp-difz [command]

Commands:
  roblox-mcp-difz                       Show this help text
  roblox-mcp-difz start                 Start HTTP + WebSocket server
  roblox-mcp-difz start:stdio           Start stdio mode (for AI clients)
  roblox-mcp-difz setup                 Interactive setup wizard
  roblox-mcp-difz setup --ai <name>     Setup for a specific AI
  roblox-mcp-difz setup --transport <t>  Transport: stdio, http, ws (default: stdio)
  roblox-mcp-difz setup --ai-list       List supported AI platforms
  roblox-mcp-difz --help                Show this help text

Server info:
  http://localhost:28429/type            Shows all endpoints available
  ws://localhost:28429/ws                WebSocket executor transport

Environment:
  MCP_PORT  HTTP server port (default: 28429)
`);
}
async function main() {
    const args = process.argv.slice(2);
    const cmd = args[0];
    if (!cmd) {
        // Bare "roblox-mcp-difz" → show help, don't start server
        console.log('\n  Roblox MCP — type "roblox-mcp-difz --help" to see available commands.\n');
        cmdHelp();
        return;
    }
    if (cmd === 'start' || cmd === 'start:http') {
        await cmdStart(false);
        return;
    }
    if (cmd === 'setup') {
        const aiFlag = args.indexOf('--ai');
        const transportFlag = args.indexOf('--transport');
        const aiListFlag = args.includes('--ai-list') || args.includes('-al');
        if (aiListFlag) {
            const setup = require('./setup');
            console.log('\nAvailable AI platforms:\n');
            for (const [key, p] of Object.entries(setup.PLATFORMS)) {
                const plat = p;
                console.log(`  ${key.padEnd(20)} ${plat.icon} ${plat.name}`);
            }
            console.log('\nAvailable transports: stdio, http, ws');
            console.log('Usage: roblox-mcp-difz setup --ai <name> [--transport <type>]\n');
            return;
        }
        const targetAI = aiFlag !== -1 ? args[aiFlag + 1] : null;
        const transport = transportFlag !== -1 ? args[transportFlag + 1] : undefined;
        await cmdSetup(targetAI, transport);
        return;
    }
    if (cmd === 'start:stdio' || args.includes('--stdio')) {
        await cmdStart(true);
        return;
    }
    if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
        cmdHelp();
        return;
    }
    // Unknown command → show hint
    console.log(`\n  Unknown: "${cmd}". Use "roblox-mcp-difz --help".\n`);
}
main().catch((err) => {
    console.error('[roblox-mcp-difz] Fatal:', err.message);
    process.exit(1);
});
