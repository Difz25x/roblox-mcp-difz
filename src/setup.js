/**
 * setup.js — Interactive MCP setup wizard for various AI platforms.
 *
 * Generates the correct MCP server config file for each AI tool.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PKG_DIR = path.resolve(__dirname, '..');
const NODE_BIN = process.execPath;
const SERVER_SCRIPT = path.join(PKG_DIR, 'src', 'cli.js');

const PLATFORMS = {
    'claude-code': {
        name: 'Claude Code',
        icon: '🤖',
        configDir: () => path.join(PKG_DIR, '.claude'),
        configFile: () => path.join(PKG_DIR, '.claude', 'settings.json'),
        instructions: () => 'Claude Code auto-detects .claude/settings.json inside the project folder. Just cd into the project.',
        generate: () => ({
            mcpServers: {
                'roblox-mcp-difz': {
                    command: NODE_BIN,
                    args: [SERVER_SCRIPT, 'start:stdio'],
                    env: {},
                },
            },
        }),
    },
    'claude-desktop': {
        name: 'Claude Desktop',
        icon: '💻',
        configDir: () => {
            const home = process.env.USERPROFILE || process.env.HOME || '';
            return path.join(home, 'AppData', 'Roaming', 'Claude');
        },
        configFile: () => {
            const home = process.env.USERPROFILE || process.env.HOME || '';
            return path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
        },
        instructions: () => 'Restart Claude Desktop after saving. Go to Settings → Developer to verify.',
        generate: () => ({
            mcpServers: {
                'roblox-mcp-difz': {
                    command: NODE_BIN,
                    args: [SERVER_SCRIPT, 'start:stdio'],
                    env: {},
                },
            },
        }),
    },
    'cursor': {
        name: 'Cursor',
        icon: '🔷',
        configDir: () => path.join(PKG_DIR, '.cursor'),
        configFile: () => path.join(PKG_DIR, '.cursor', 'mcp.json'),
        instructions: () => 'Cursor reads .cursor/mcp.json from the project root. Auto-detects on restart.',
        generate: () => ({
            mcpServers: {
                'roblox-mcp-difz': {
                    command: NODE_BIN,
                    args: [SERVER_SCRIPT, 'start:stdio'],
                    env: {},
                },
            },
        }),
    },
    'windsurf': {
        name: 'Windsurf',
        icon: '🏄',
        configDir: () => path.join(PKG_DIR, '.windsurf'),
        configFile: () => path.join(PKG_DIR, '.windsurf', 'mcp_config.json'),
        instructions: () => 'Windsurf reads .windsurf/mcp_config.json from the project root.',
        generate: () => ({
            mcpServers: {
                'roblox-mcp-difz': {
                    command: NODE_BIN,
                    args: [SERVER_SCRIPT, 'start:stdio'],
                    env: {},
                },
            },
        }),
    },
    'vscode': {
        name: 'VS Code (Cline / Continue)',
        icon: '📝',
        configDir: () => {
            const home = process.env.USERPROFILE || process.env.HOME || '';
            return path.join(home, '.vscode');
        },
        configFile: () => {
            const home = process.env.USERPROFILE || process.env.HOME || '';
            return path.join(home, '.vscode', 'mcp.json');
        },
        instructions: () => 'VS Code extensions like Cline or Continue read this config.',
        generate: () => ({
            mcpServers: {
                'roblox-mcp-difz': {
                    command: NODE_BIN,
                    args: [SERVER_SCRIPT, 'start:stdio'],
                    env: {},
                },
            },
        }),
    },
    'generic': {
        name: 'Generic MCP Client',
        icon: '🔌',
        configDir: () => PKG_DIR,
        configFile: () => path.join(PKG_DIR, 'mcp-config.json'),
        instructions: () => 'Use this JSON wherever your MCP client expects a server definition.',
        generate: () => ({
            mcpServers: {
                'roblox-mcp-difz': {
                    command: NODE_BIN,
                    args: [SERVER_SCRIPT, 'start:stdio'],
                    env: {},
                },
            },
        }),
    },
};

function question(rl, query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function runSetupWizard(targetAI) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║     Roblox MCP — Setup Wizard                   ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');

    let selectedKeys;

    if (targetAI) {
        const key = targetAI.toLowerCase().replace(/ /g, '-');
        if (PLATFORMS[key]) {
            selectedKeys = [key];
            console.log(`  → Auto-setup for: ${PLATFORMS[key].icon} ${PLATFORMS[key].name}`);
        } else {
            console.log(`  ✗ Unknown AI: "${targetAI}". Falling back to interactive.`);
            selectedKeys = null;
        }
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
        } else {
            selectedKeys = [];
            const parts = trimmed.split(',').map(s => s.trim());
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
    console.log('  Generating config files...');
    console.log('');

    let successCount = 0;

    for (const key of selectedKeys) {
        const platform = PLATFORMS[key];
        const configDir = platform.configDir();
        const configFile = platform.configFile();
        const config = platform.generate();

        try {
            fs.mkdirSync(configDir, { recursive: true });

            let merged = config;
            if (fs.existsSync(configFile)) {
                try {
                    const existing = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
                    merged = {
                        mcpServers: {
                            ...(existing.mcpServers || {}),
                            ...config.mcpServers,
                        },
                    };
                } catch {}
            }

            fs.writeFileSync(configFile, JSON.stringify(merged, null, 2), 'utf-8');
            console.log(`  ✅ ${platform.icon} ${platform.name}`);
            console.log(`     File: ${configFile}`);
            console.log(`     ${platform.instructions()}`);
            console.log('');
            successCount++;
        } catch (err) {
            console.log(`  ❌ ${platform.icon} ${platform.name} — Failed: ${err.message}`);
            console.log('');
        }
    }

    console.log(`  Done! ${successCount}/${selectedKeys.length} config(s) created.`);
    console.log('');
    console.log('  Next steps:');
    console.log('  1. Start the server:  roblox-mcp-difz start');
    console.log('  2. For stdio mode:    roblox-mcp-difz start:stdio');
    console.log('  3. Inject mcp.luau into your Roblox executor');
    console.log('  4. Start chatting with AI!');
    console.log('');

    rl.close();
}

module.exports = { runSetupWizard, PLATFORMS };
