#!/usr/bin/env node

/**
 * cli.js — CLI dispatcher for roblox-mcp
 *
 * Commands:
 *   roblox-mcp              → start HTTP server
 *   roblox-mcp start        → start HTTP server
 *   roblox-mcp start:stdio  → start stdio MCP transport + HTTP
 *   roblox-mcp setup        → interactive setup wizard
 *   roblox-mcp setup --ai <name> → auto-setup for specific AI
 */
const path = require('path');
const readline = require('readline');

function printBanner(port, toolsCount, mode) {
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║           Roblox MCP Server v2.0.0                  ║');
    console.log('╠══════════════════════════════════════════════════════╣');
    console.log(`║  HTTP Server : http://localhost:${port}               ║`);
    console.log(`║  MCP Endpoint: POST http://localhost:${port}/mcp      ║`);
    console.log(`║  Client Script: http://localhost:${port}/mcp.luau     ║`);
    console.log(`║  Tools       : ${String(toolsCount).padStart(2)} registered                  ║`);
    console.log(`║  Mode        : ${mode}              ║`);
    console.log('╚══════════════════════════════════════════════════════╝');
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

    const { app, tools, mcp } = createApp({ stdio: stdioMode });

    app.listen(PORT, () => {
        printBanner(PORT, tools.count, stdioMode ? 'HTTP + stdio MCP' : 'HTTP only');

        if (stdioMode) {
            console.log('[MCP] stdio transport active — waiting for JSON-RPC messages on stdin…');
            const rl = readline.createInterface({ input: process.stdin });
            rl.on('line', async (line) => {
                const trimmed = line.trim();
                if (!trimmed) return;
                let message;
                try { message = JSON.parse(trimmed); } catch { return; }
                if (message.id === undefined || message.id === null) {
                    try { await mcp.handleMessage(message); } catch {}
                    return;
                }
                try {
                    const result = await mcp.handleMessage(message);
                    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...result }) + '\n');
                } catch (err) {
                    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: err.message } }) + '\n');
                }
            });
            rl.on('close', () => process.exit(0));
        }
    });
}

async function cmdSetup(targetAI) {
    const { runSetupWizard } = require('./setup');
    await runSetupWizard(targetAI);
}

function cmdHelp() {
    console.log(`
roblox-mcp — Roblox MCP Server

USAGE:
  roblox-mcp                     Start HTTP server (port 28429)
  roblox-mcp start               Start HTTP server
  roblox-mcp start:stdio         Start stdio MCP transport + HTTP
  roblox-mcp setup               Interactive setup wizard
  roblox-mcp setup --ai <name>   Setup for specific AI (claude-code, claude-desktop, cursor, windsurf, generic)
  roblox-mcp --help              Show this help

ENV:
  MCP_PORT  Port for HTTP server (default: 28429)
`);
}

async function main() {
    const args = process.argv.slice(2);
    const cmd = args[0];

    if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
        cmdHelp();
        return;
    }

    if (cmd === 'setup') {
        const aiFlag = args.indexOf('--ai');
        const targetAI = aiFlag !== -1 ? args[aiFlag + 1] : null;
        await cmdSetup(targetAI);
        return;
    }

    if (cmd === 'start:stdio' || args.includes('--stdio')) {
        await cmdStart(true);
        return;
    }

    await cmdStart(false);
}

if (require.main === module) {
    main().catch(err => {
        console.error('[roblox-mcp] Fatal:', err.message);
        process.exit(1);
    });
}
