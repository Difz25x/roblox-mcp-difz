/**
 * setup.ts — MCP setup wizard.
 * Configures AI platforms to connect via HTTP to the running server.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const CWD = process.cwd();
const MCP_PORT = parseInt(process.env.MCP_PORT!, 10) || 28429;

function normPath(p: string): string {
    return p.replace(/\\/g, '/');
}

function removeServerFromJson(filePath: string, serverName: string): boolean {
    if (!fs.existsSync(filePath)) return false;
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (!data.mcpServers || !data.mcpServers[serverName]) return false;
        delete data.mcpServers[serverName];
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        return true;
    } catch { return false; }
}

function getDevCliPath(): string | null {
    try {
        const pkgPath = path.join(CWD, 'package.json');
        if (!fs.existsSync(pkgPath)) return null;
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name !== 'roblox-mcp-difz') return null;
        const cliPath = path.join(CWD, 'dist', 'cli.js');
        if (!fs.existsSync(cliPath)) return null;
        return normPath(cliPath);
    } catch { return null; }
}

const HTTP_CONFIG = {
    mcpServers: {
        'roblox-mcp-difz': { type: 'http', url: `http://localhost:${MCP_PORT}/mcp` },
    },
};

const PLATFORMS: Record<string, { name: string; icon: string; instructions: string; setup: () => Promise<boolean> }> = {
    'claude-code': {
        name: 'Claude Code', icon: '🤖',
        instructions: 'Registered via claude mcp add (HTTP).',
        setup: async () => {
            removeServerFromJson(path.join(HOME, '.mcp.json'), 'roblox-mcp-difz');
            try {
                const cmd = `claude mcp add roblox-mcp-difz -s user --transport http http://localhost:${MCP_PORT}/mcp`;
                const result = execSync(cmd, { stdio: 'pipe', timeout: 15000, windowsHide: true });
                console.log(`     ${result.toString().trim().split('\n').pop()}`);
                return true;
            } catch (err: any) {
                const msg = err.stderr?.toString() || err.message || '';
                if (msg.includes('already exists') || msg.includes('Added')) return true;
                console.error(`     Error: ${msg.trim()}`);
                return false;
            }
        },
    },
    'claude-desktop': {
        name: 'Claude Desktop', icon: '💻',
        instructions: 'Restart Claude Desktop.',
        setup: async () => writeConfigFile(
            path.join(HOME, 'AppData', 'Roaming', 'Claude'),
            path.join(HOME, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
            HTTP_CONFIG,
        ),
    },
    'cursor': {
        name: 'Cursor', icon: '🔷',
        instructions: 'Config at ~/.cursor/mcp.json.',
        setup: async () => writeConfigFile(
            path.join(HOME, '.cursor'),
            path.join(HOME, '.cursor', 'mcp.json'),
            HTTP_CONFIG,
        ),
    },
    'windsurf': {
        name: 'Windsurf', icon: '🏄',
        instructions: 'Config at ~/.windsurf/mcp_config.json.',
        setup: async () => writeConfigFile(
            path.join(HOME, '.windsurf'),
            path.join(HOME, '.windsurf', 'mcp_config.json'),
            HTTP_CONFIG,
        ),
    },
    'vscode': {
        name: 'VS Code (Cline / Continue)', icon: '📝',
        instructions: 'Config at ~/.vscode/mcp.json.',
        setup: async () => writeConfigFile(
            path.join(HOME, '.vscode'),
            path.join(HOME, '.vscode', 'mcp.json'),
            HTTP_CONFIG,
        ),
    },
    'generic': {
        name: 'Generic MCP Client', icon: '🔌',
        instructions: 'Saved to CWD as mcp-config.json.',
        setup: async () => writeConfigFile(CWD, path.join(CWD, 'mcp-config.json'), HTTP_CONFIG),
    },
};

function writeConfigFile(configDir: string, configFile: string, config: Record<string, any>): boolean {
    try {
        fs.mkdirSync(configDir, { recursive: true });
        let merged = config;
        if (fs.existsSync(configFile)) {
            try {
                const existing = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
                merged = { ...existing, mcpServers: { ...(existing.mcpServers || {}), ...config.mcpServers } };
            } catch (e: any) {
                console.error(`     Warning: could not parse config (${e.message}), overwriting.`);
            }
        }
        fs.writeFileSync(configFile, JSON.stringify(merged, null, 2), 'utf-8');
        console.log(`     File: ${normPath(configFile)}`);
        return true;
    } catch (err: any) {
        console.error(`     Failed: ${err.message}`);
        return false;
    }
}

function question(rl: any, query: string): Promise<string> {
    return new Promise<string>(resolve => rl.question(query, resolve));
}

async function runSetupWizard(targetAI?: string): Promise<void> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log('\n  Roblox MCP — Setup\n');

    let selectedKeys: string[] | null = null;

    if (targetAI) {
        const key = targetAI.toLowerCase().replace(/ /g, '-');
        if (PLATFORMS[key]) {
            selectedKeys = [key];
            console.log(`  Auto-setup for: ${PLATFORMS[key].icon} ${PLATFORMS[key].name}`);
        } else {
            console.log(`  Unknown AI: "${targetAI}".`);
            rl.close(); return;
        }
    } else {
        console.log('  Select AI platform(s):\n');
        const keys = Object.keys(PLATFORMS);
        for (let i = 0; i < keys.length; i++) console.log(`    ${i + 1}. ${PLATFORMS[keys[i]].icon} ${PLATFORMS[keys[i]].name}`);
        console.log('');
        const answer = await question(rl, '  Enter numbers (comma-separated, or "all"): ');
        const trimmed = answer.trim().toLowerCase();
        if (trimmed === 'all') { selectedKeys = keys; }
        else {
            selectedKeys = [];
            for (const part of trimmed.split(',').map((s: string) => s.trim())) {
                const idx = parseInt(part, 10) - 1;
                if (idx >= 0 && idx < keys.length) selectedKeys.push(keys[idx]);
            }
        }
        if (!selectedKeys || selectedKeys.length === 0) { console.log('  No selection. Exiting.'); rl.close(); return; }
    }

    console.log('\n  Configuring (HTTP transport)...\n');
    let successCount = 0;
    for (const key of selectedKeys) {
        const platform = PLATFORMS[key];
        process.stdout.write(`  ${platform.icon} ${platform.name}... `);
        const ok = await platform.setup();
        console.log(ok ? `✅\n     ${platform.instructions}` : `❌`);
        console.log('');
        if (ok) successCount++;
    }

    console.log(`  Done! ${successCount}/${selectedKeys.length}\n`);
    const devPath = getDevCliPath();
    if (devPath) {
        console.log(`  Start server: node ${devPath} start`);
        console.log(`  Inject: loadstring(game:HttpGet("http://127.0.0.1:${MCP_PORT}/mcp.lua"))()`);
    } else {
        console.log(`  Start server: rblx-mcp start`);
        console.log(`  Inject: loadstring(game:HttpGet("http://127.0.0.1:${MCP_PORT}/mcp.lua"))()`);
    }
    console.log('');
    rl.close();
}

module.exports = { runSetupWizard, PLATFORMS };
