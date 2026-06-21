#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * cli.ts — CLI dispatcher for roblox-mcp-difz
 *
 * Commands:
 *   roblox-mcp-difz              → show help
 *   roblox-mcp-difz start        → start HTTP server
 *   roblox-mcp-difz start:stdio  → start stdio MCP transport + HTTP
 *   roblox-mcp-difz setup        → interactive setup wizard
 *   roblox-mcp-difz setup --ai <name>     auto-setup for specific AI
 *   roblox-mcp-difz setup --transport <t>  transport: stdio, http, ws
 *   roblox-mcp-difz setup --ai-list       list available AI platforms
 */
const path = require('path');
const readline = require('readline');
const PKG = require('../package.json');
function printBanner(port, toolsCount, mode, wsCount) {
    const BOX = 54;
    const pad = (s) => s + ' '.repeat(Math.max(0, BOX - s.length));
    console.log('╔' + '═'.repeat(BOX) + '╗');
    console.log(`║${pad(`           Roblox MCP Server v${PKG.version}`)}║`);
    console.log('╠' + '═'.repeat(BOX) + '╣');
    console.log(`║${pad(`  HTTP : http://localhost:${port}/mcp`)}║`);
    console.log(`║${pad(`  WS   : ws://localhost:${port}/ws`)}║`);
    console.log(`║${pad(`  Info : http://localhost:${port}/type`)}║`);
    console.log(`║${pad(`  Tools: ${toolsCount} registered`)}║`);
    console.log(`║${pad(`  Mode : ${mode}`)}║`);
    console.log('╚' + '═'.repeat(BOX) + '╝');
}
async function cmdStart(stdioMode) {
    const { createApp } = require('./server-core');
    const PORT = parseInt(process.env.MCP_PORT, 10) || 28429;
    if (stdioMode) {
        const orig = console.log;
        console.log = function (...args) {
            process.stderr.write('[MCP] ' + args.join(' ') + '\n');
        };
    }
    const { app, server, tools, mcp, wss } = createApp({ stdio: stdioMode });
    server.listen(PORT, () => {
        const mode = stdioMode ? 'HTTP + stdio MCP + WS' : 'HTTP + WS';
        printBanner(PORT, tools.count, mode, wss ? wss.connectedCount : 0);
        if (stdioMode) {
            console.log('[MCP] stdio transport active — waiting for JSON-RPC messages on stdin…');
            const rl = readline.createInterface({ input: process.stdin });
            rl.on('line', async (line) => {
                const trimmed = line.trim();
                if (!trimmed)
                    return;
                let message;
                try {
                    message = JSON.parse(trimmed);
                }
                catch {
                    return;
                }
                if (message.id === undefined || message.id === null) {
                    try {
                        await mcp.handleMessage(message);
                    }
                    catch { }
                    return;
                }
                try {
                    const result = await mcp.handleMessage(message);
                    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...result }) + '\n');
                }
                catch (err) {
                    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: err.message } }) + '\n');
                }
            });
            rl.on('close', () => process.exit(0));
        }
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
  roblox-mcp-difz                       Show this help (does not start)
  roblox-mcp-difz start                 Start HTTP server (port 28429)
  roblox-mcp-difz start:stdio           Start stdio mode (for AI clients)
  roblox-mcp-difz setup                 Interactive setup wizard
  roblox-mcp-difz setup --ai <name>     Auto-setup for a specific AI
  roblox-mcp-difz setup --transport <t>  Transport: stdio, http, ws
  roblox-mcp-difz setup --ai-list       List supported AI platforms
  roblox-mcp-difz --help                Show this help

Endpoints:
  http://localhost:28429/type            Server info (active transport)
  http://localhost:28429/mcp             MCP HTTP endpoint (POST)
  ws://localhost:28429/ws                WebSocket transport

Environment:
  MCP_PORT  HTTP server port (default: 28429)
`);
}
async function main() {
    const args = process.argv.slice(2);
    const cmd = args[0];
    if (!cmd) {
        console.log('\n  Roblox MCP — type "roblox-mcp-difz --help" to see available commands.\n');
        cmdHelp();
        return;
    }
    if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
        cmdHelp();
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
    if (cmd === 'start' || cmd === 'start:http') {
        await cmdStart(false);
        return;
    }
    if (cmd === 'start:stdio' || args.includes('--stdio')) {
        await cmdStart(true);
        return;
    }
    console.log(`\n  Unknown: "${cmd}". Use "roblox-mcp-difz --help".\n`);
    cmdHelp();
}
main().catch((err) => {
    console.error('[roblox-mcp-difz] Fatal:', err.message);
    process.exit(1);
});
