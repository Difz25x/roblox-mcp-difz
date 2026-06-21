"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * setup.ts — Interactive MCP setup wizard for various AI platforms.
 *
 * Generates the correct MCP server config file for each AI tool
 * using the user's chosen transport type (stdio, http, or websocket).
 *
 * Config files go to USER's home directory (not package dir) so they
 * work with globally installed packages.
 *
 * Claude Code uses the official CLI command `claude mcp add` instead of
 * writing config files directly.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const CWD = process.cwd();
const MCP_PORT = parseInt(process.env.MCP_PORT, 10) || 28429;
const TRANSPORTS = [
    { key: 'stdio', icon: '🔌', label: 'Stdio', desc: 'Run as subprocess (fastest, for Claude Code, Cursor, etc.)' },
    { key: 'http', icon: '🌐', label: 'HTTP', desc: 'Connect via HTTP POST (requires server running, for Claude Desktop, etc.)' },
    { key: 'ws', icon: '🔗', label: 'WebSocket', desc: 'Connect via WebSocket (requires server running, for custom clients)' },
];
const PLATFORMS = {
    'claude-code': {
        name: 'Claude Code',
        icon: '🤖',
        instructions: (t) => {
            if (t === 'stdio')
                return 'Registered via claude mcp add (stdio).';
            if (t === 'http')
                return 'Registered via claude mcp add (HTTP transport). Start server first.';
            return 'Claude Code supports stdio or HTTP — use stdio for best results.';
        },
        setup: async (transport) => {
            try {
                let cmd;
                if (transport === 'stdio') {
                    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
                    const cliPath = path.join(globalRoot, 'roblox-mcp-difz', 'dist', 'cli.js');
                    cmd = `claude mcp add roblox-mcp-difz -s user -- node "${cliPath}" start:stdio`;
                }
                else if (transport === 'http') {
                    cmd = `claude mcp add roblox-mcp-difz -s user --transport http http://localhost:${MCP_PORT}/mcp`;
                }
                else {
                    cmd = `claude mcp add roblox-mcp-difz -s user --transport sse http://localhost:${MCP_PORT}/mcp`;
                }
                const result = execSync(cmd, { stdio: 'pipe', timeout: 15000, windowsHide: true });
                console.log(`     ${result.toString().trim().split('\n').pop()}`);
                return true;
            }
            catch (err) {
                const msg = err.stderr?.toString() || err.message || 'Unknown error';
                if (msg.includes('already exists') || msg.includes('Added')) {
                    return true;
                }
                console.error(`     Error: ${msg.trim()}`);
                return false;
            }
        },
    },
    'claude-desktop': {
        name: 'Claude Desktop',
        icon: '💻',
        instructions: (t) => `Restart Claude Desktop after saving. Settings > Developer to verify. (${t})`,
        setup: async (transport) => {
            return writeConfigFile(path.join(HOME, 'AppData', 'Roaming', 'Claude'), path.join(HOME, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'), generateConfigForPlatform('claude-desktop', transport));
        },
    },
    'cursor': {
        name: 'Cursor',
        icon: '🔷',
        instructions: (t) => `Global config at ~/.cursor/mcp.json. Cursor detects it automatically. (${t})`,
        setup: async (transport) => {
            return writeConfigFile(path.join(HOME, '.cursor'), path.join(HOME, '.cursor', 'mcp.json'), generateConfigForPlatform('cursor', transport));
        },
    },
    'windsurf': {
        name: 'Windsurf',
        icon: '🏄',
        instructions: (t) => `Global config at ~/.windsurf/mcp_config.json. (${t})`,
        setup: async (transport) => {
            return writeConfigFile(path.join(HOME, '.windsurf'), path.join(HOME, '.windsurf', 'mcp_config.json'), generateConfigForPlatform('windsurf', transport));
        },
    },
    'vscode': {
        name: 'VS Code (Cline / Continue)',
        icon: '📝',
        instructions: (t) => `Global config at ~/.vscode/mcp.json. Used by Cline/Continue. (${t})`,
        setup: async (transport) => {
            return writeConfigFile(path.join(HOME, '.vscode'), path.join(HOME, '.vscode', 'mcp.json'), generateConfigForPlatform('vscode', transport));
        },
    },
    'generic': {
        name: 'Generic MCP Client',
        icon: '🔌',
        instructions: (t) => `Saved to current working directory. Copy the JSON wherever needed. (${t})`,
        setup: async (transport) => {
            return writeConfigFile(CWD, path.join(CWD, 'mcp-config.json'), generateConfigForPlatform('generic', transport));
        },
    },
};
function getNodeDirectCommand() {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    const cliPath = path.join(globalRoot, 'roblox-mcp-difz', 'dist', 'cli.js');
    return { command: 'node', args: [cliPath, 'start:stdio'] };
}
function generateConfigForPlatform(_platform, transport) {
    if (transport === 'stdio') {
        let cmd;
        let args;
        try {
            const direct = getNodeDirectCommand();
            cmd = direct.command;
            args = direct.args;
        }
        catch {
            cmd = 'npx';
            args = ['roblox-mcp-difz', 'start:stdio'];
        }
        return { mcpServers: { 'roblox-mcp-difz': { command: cmd, args, env: {} } } };
    }
    else if (transport === 'http') {
        return {
            mcpServers: {
                'roblox-mcp-difz': {
                    type: 'http',
                    url: `http://localhost:${MCP_PORT}/mcp`,
                },
            },
        };
    }
    else {
        return {
            mcpServers: {
                'roblox-mcp-difz': {
                    url: `ws://localhost:${MCP_PORT}/ws`,
                },
            },
        };
    }
}
function writeConfigFile(configDir, configFile, config) {
    try {
        fs.mkdirSync(configDir, { recursive: true });
        let merged = config;
        if (fs.existsSync(configFile)) {
            try {
                const existing = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
                merged = {
                    ...existing,
                    mcpServers: {
                        ...(existing.mcpServers || {}),
                        ...config.mcpServers,
                    },
                };
            }
            catch (e) {
                console.error(`     Warning: could not parse existing config (${e.message}), overwriting.`);
            }
        }
        fs.writeFileSync(configFile, JSON.stringify(merged, null, 2), 'utf-8');
        console.log(`     File: ${configFile}`);
        return true;
    }
    catch (err) {
        console.error(`     Failed: ${err.message}`);
        return false;
    }
}
function question(rl, query) {
    return new Promise(resolve => rl.question(query, resolve));
}
async function runSetupWizard(targetAI, transportArg) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║     Roblox MCP — Setup Menu                   ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');
    // Step 1: Choose transport type
    let transport;
    if (transportArg && TRANSPORTS.some(t => t.key === transportArg)) {
        transport = transportArg;
        console.log(`  → Transport: ${TRANSPORTS.find(t => t.key === transport)?.icon} ${transport.toUpperCase()}`);
    }
    else if (targetAI === 'claude-code') {
        transport = 'stdio';
        console.log(`  → Transport: 🔌 STDIO (default for Claude Code)`);
    }
    else {
        console.log('  Select transport type:');
        console.log('');
        for (let i = 0; i < TRANSPORTS.length; i++) {
            console.log(`    ${i + 1}. ${TRANSPORTS[i].icon} ${TRANSPORTS[i].label} — ${TRANSPORTS[i].desc}`);
        }
        console.log('');
        const tAnswer = await question(rl, '  Enter number (1-3) [default: 1]: ');
        const tIdx = parseInt(tAnswer.trim(), 10) - 1;
        transport = (tIdx >= 0 && tIdx < TRANSPORTS.length) ? TRANSPORTS[tIdx].key : 'stdio';
        console.log(`  → Selected: ${TRANSPORTS.find(t => t.key === transport)?.icon} ${transport.toUpperCase()}`);
        console.log('');
    }
    // Step 2: Choose AI platform
    let selectedKeys;
    if (targetAI) {
        const key = targetAI.toLowerCase().replace(/ /g, '-');
        if (PLATFORMS[key]) {
            selectedKeys = [key];
            console.log(`  → Auto-setup for: ${PLATFORMS[key].icon} ${PLATFORMS[key].name}`);
        }
        else {
            console.log(`  ✗ Unknown AI: "${targetAI}". Use --ai-list to see available options.`);
            selectedKeys = null;
        }
    }
    else {
        selectedKeys = null;
    }
    if (!selectedKeys) {
        console.log('  Select AI platform(s) to configure:');
        console.log('');
        const keys = Object.keys(PLATFORMS);
        for (let i = 0; i < keys.length; i++) {
            const p = PLATFORMS[keys[i]];
            console.log(`    ${i + 1}. ${p.icon} ${p.name}`);
        }
        console.log('');
        const answer = await question(rl, '  Enter numbers (comma-separated, e.g. "1,3" or "all"): ');
        const trimmed = answer.trim().toLowerCase();
        if (trimmed === 'all') {
            selectedKeys = keys;
        }
        else {
            selectedKeys = [];
            const parts = trimmed.split(',').map((s) => s.trim());
            for (const part of parts) {
                const idx = parseInt(part, 10) - 1;
                if (idx >= 0 && idx < keys.length) {
                    selectedKeys.push(keys[idx]);
                }
            }
        }
        if (selectedKeys.length === 0) {
            console.log('  No valid selection. Exiting.');
            rl.close();
            return;
        }
    }
    console.log('');
    console.log('  Configuring...');
    console.log('');
    let successCount = 0;
    for (const key of selectedKeys) {
        const platform = PLATFORMS[key];
        process.stdout.write(`  ${platform.icon} ${platform.name} (${transport.toUpperCase()})... `);
        const ok = await platform.setup(transport);
        if (ok) {
            console.log(`✅`);
            console.log(`     ${platform.instructions(transport)}`);
            successCount++;
        }
        else {
            console.log(`❌`);
        }
        console.log('');
    }
    console.log(`  Done! ${successCount}/${selectedKeys.length} config(s) created.`);
    console.log('');
    console.log('  Next steps:');
    if (transport === 'stdio') {
        console.log('  1. Start the server in HTTP mode:  roblox-mcp-difz start');
        console.log('  2. Or start in stdio-only mode:    roblox-mcp-difz start:stdio');
        console.log('  3. For executor transport:         ws://localhost:28429/ws');
    }
    else {
        console.log(`  1. Start the server first:  roblox-mcp-difz start`);
        console.log(`  2. Connect via ${transport.toUpperCase()}: ${transport === 'http' ? 'POST http://localhost:28429/mcp' : 'ws://localhost:28429/ws'}`);
    }
    console.log('  3. Inject mcp.luau into your Roblox executor');
    console.log('  4. Check server info:     http://localhost:28429/type');
    console.log('');
    rl.close();
}
module.exports = { runSetupWizard, PLATFORMS, TRANSPORTS };
