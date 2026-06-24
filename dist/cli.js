#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const PKG = require('../package.json');
function printBanner(port, toolsCount, wsCount) {
    const BOX = 54;
    const pad = (s) => s + ' '.repeat(Math.max(0, BOX - s.length));
    console.log('╔' + '═'.repeat(BOX) + '╗');
    console.log(`║${pad(`      Roblox MCP Server v${PKG.version}`)}║`);
    console.log('╠' + '═'.repeat(BOX) + '╣');
    console.log(`║${pad(`  HTTP: http://localhost:${port}/mcp`)}║`);
    console.log(`║${pad(`  WS  : ws://localhost:${port}/ws`)}║`);
    console.log(`║${pad(`  Info: http://localhost:${port}/type`)}║`);
    console.log(`║${pad(`  Tools: ${toolsCount}`)}║`);
    console.log(`║${pad(`  WS connections: ${wsCount}`)}║`);
    console.log('╚' + '═'.repeat(BOX) + '╝');
}
async function cmdStart() {
    const { createApp } = require('./server-core');
    const PORT = parseInt(process.env.MCP_PORT, 10) || 28429;
    const { server, tools, wss } = createApp();
    server.listen(PORT, () => {
        printBanner(PORT, tools.count, wss.connectedCount);
        console.log(`\n  Start mcp.lua in executor:\n    loadstring(game:HttpGet("http://127.0.0.1:${PORT}/mcp.lua"))()`);
    });
}
async function cmdSetup(targetAI) {
    const { runSetupWizard } = require('./setup');
    await runSetupWizard(targetAI);
}
function cmdHelp() {
    console.log(`
Usage: rblx-mcp [command]

Commands:
  rblx-mcp                       Show this help
  rblx-mcp start                 Start server (HTTP+WS, port ${process.env.MCP_PORT || 28429})
  rblx-mcp setup                 Interactive setup wizard
  rblx-mcp setup --ai <name>     Auto-setup for a specific AI
  rblx-mcp setup --ai-list       List supported AI platforms
  rblx-mcp --help                Show this help

Endpoints:
  http://localhost:${process.env.MCP_PORT || 28429}/type     Server info
  http://localhost:${process.env.MCP_PORT || 28429}/mcp      MCP JSON-RPC (POST)
  ws://localhost:${process.env.MCP_PORT || 28429}/ws         WebSocket (executor)

Executor:
  loadstring(game:HttpGet("http://127.0.0.1:${process.env.MCP_PORT || 28429}/mcp.lua"))()

Environment:
  MCP_PORT  Server port (default: 28429)
`);
}
async function main() {
    const args = process.argv.slice(2);
    const cmd = args[0];
    if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
        cmdHelp();
        return;
    }
    if (cmd === 'setup') {
        const aiFlag = args.indexOf('--ai');
        const aiListFlag = args.includes('--ai-list') || args.includes('-al');
        if (aiListFlag) {
            const setup = require('./setup');
            console.log('\nAvailable AI platforms:\n');
            for (const [key, p] of Object.entries(setup.PLATFORMS)) {
                const plat = p;
                console.log(`  ${key.padEnd(20)} ${plat.icon} ${plat.name}`);
            }
            console.log();
            return;
        }
        const targetAI = aiFlag !== -1 ? args[aiFlag + 1] : null;
        await cmdSetup(targetAI);
        return;
    }
    if (cmd === 'start' || cmd === 'start:http') {
        await cmdStart();
        return;
    }
    console.log(`\n  Unknown: "${cmd}". Use "rblx-mcp --help".\n`);
    cmdHelp();
}
main().catch((err) => {
    console.error('[rblx-mcp] Fatal:', err.message);
    process.exit(1);
});
