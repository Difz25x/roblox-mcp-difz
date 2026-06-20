/**
 * setup.js — Interactive MCP setup wizard for various AI platforms.
 *
 * Generates the correct MCP server config file for each AI tool.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PKG_DIR: string = path.resolve(__dirname, '..');
const NODE_BIN: string = process.execPath;
const SERVER_SCRIPT: string = path.join(PKG_DIR, 'src', 'cli.js');

interface PlatformEntry {
    name: string;
    icon: string;
    configDir: () => string;
    configFile: () => string;
    instructions: () => string;
    generate: () => { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> };
}

const PLATFORMS: Record<string, PlatformEntry> = {
    'claude-code': {
        name: 'Claude Code',
        icon: '🤖',
        configDir: (): string => path.join(PKG_DIR, '.claude'),
        configFile: (): string => path.join(PKG_DIR, '.claude', 'settings.json'),
        instructions: (): string => 'Claude Code auto-detects .claude/settings.json inside the project folder. Just cd into the project.',
        generate: (): { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> } => ({
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
        configDir: (): string => {
            const home: string = process.env.USERPROFILE || process.env.HOME || '';
            return path.join(home, 'AppData', 'Roaming', 'Claude');
        },
        configFile: (): string => {
            const home: string = process.env.USERPROFILE || process.env.HOME || '';
            return path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
        },
        instructions: (): string => 'Restart Claude Desktop after saving. Go to Settings → Developer to verify.',
        generate: (): { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> } => ({
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
        configDir: (): string => path.join(PKG_DIR, '.cursor'),
        configFile: (): string => path.join(PKG_DIR, '.cursor', 'mcp.json'),
        instructions: (): string => 'Cursor reads .cursor/mcp.json from the project root. Auto-detects on restart.',
        generate: (): { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> } => ({
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
        configDir: (): string => path.join(PKG_DIR, '.windsurf'),
        configFile: (): string => path.join(PKG_DIR, '.windsurf', 'mcp_config.json'),
        instructions: (): string => 'Windsurf reads .windsurf/mcp_config.json from the project root.',
        generate: (): { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> } => ({
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
        configDir: (): string => {
            const home: string = process.env.USERPROFILE || process.env.HOME || '';
            return path.join(home, '.vscode');
        },
        configFile: (): string => {
            const home: string = process.env.USERPROFILE || process.env.HOME || '';
            return path.join(home, '.vscode', 'mcp.json');
        },
        instructions: (): string => 'VS Code extensions like Cline or Continue read this config.',
        generate: (): { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> } => ({
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
        configDir: (): string => PKG_DIR,
        configFile: (): string => path.join(PKG_DIR, 'mcp-config.json'),
        instructions: (): string => 'Use this JSON wherever your MCP client expects a server definition.',
        generate: (): { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> } => ({
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

function question(rl: any, query: string): Promise<string> {
    return new Promise<string>(resolve => rl.question(query, resolve));
}

async function runSetupWizard(targetAI?: string): Promise<void> {
    const rl: any = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║     Roblox MCP — Setup Wizard                   ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');

    let selectedKeys: string[] | null;

    if (targetAI) {
        const key: string = targetAI.toLowerCase().replace(/ /g, '-');
        if (PLATFORMS[key]) {
            selectedKeys = [key];
            console.log(`  → Auto-setup for: ${PLATFORMS[key].icon} ${PLATFORMS[key].name}`);
        } else {
            console.log(`  ✗ Unknown AI: "${targetAI}". Falling back to interactive.`);
            selectedKeys = null;
        }
    } else {
        selectedKeys = null;
    }

    if (!selectedKeys) {
        console.log('  Select AI platform(s) to configure:');
        console.log('');
        const keys: string[] = Object.keys(PLATFORMS);
        for (let i = 0; i < keys.length; i++) {
            const p: PlatformEntry = PLATFORMS[keys[i]];
            console.log(`    ${i + 1}. ${p.icon} ${p.name}`);
        }
        console.log('');
        const answer: string = await question(rl, '  Enter numbers (comma-separated, e.g. "1,3" or "all"): ');
        const trimmed: string = answer.trim().toLowerCase();

        if (trimmed === 'all') {
            selectedKeys = keys;
        } else {
            selectedKeys = [];
            const parts: string[] = trimmed.split(',').map((s: string) => s.trim());
            for (const part of parts) {
                const idx: number = parseInt(part, 10) - 1;
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

    let successCount: number = 0;

    for (const key of selectedKeys) {
        const platform: PlatformEntry = PLATFORMS[key];
        const configDir: string = platform.configDir();
        const configFile: string = platform.configFile();
        const config: { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> } = platform.generate();

        try {
            fs.mkdirSync(configDir, { recursive: true });

            let merged: { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> } = config;
            if (fs.existsSync(configFile)) {
                try {
                    const existing: { mcpServers?: Record<string, { command: string; args: string[]; env: Record<string, string> }> } = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
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
        } catch (err: any) {
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
