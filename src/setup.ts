/**
 * setup.ts — Interactive MCP setup wizard for various AI platforms.
 *
 * Generates the correct MCP server config file for each AI tool
 * using the user's chosen transport type (stdio, http, or websocket).
 *
 * v2 fixes:
 *  - Detects dev directory (CWD = roblox-mcp-difz repo) → uses local build
 *  - Adds `type: "stdio"` to stdio config for Claude Code v2 compat
 *  - Forward slashes in paths to avoid Windows escape issues (\r, \n, etc.)
 *  - Validates server binary exists before saving config
 *  - Falls back to direct ~/.mcp.json write if `claude` CLI unavailable
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

const HOME: string = process.env.USERPROFILE || process.env.HOME || '';
const CWD: string = process.cwd();
const MCP_PORT: number = parseInt(process.env.MCP_PORT as string, 10) || 28429;

type TransportType = 'stdio' | 'http' | 'ws';

const TRANSPORTS: Array<{ key: TransportType; icon: string; label: string; desc: string }> = [
    { key: 'stdio', icon: '🔌', label: 'Stdio', desc: 'Run as subprocess (fastest, for Claude Code, Cursor, etc.)' },
    { key: 'http', icon: '🌐', label: 'HTTP', desc: 'Connect via HTTP POST (requires server running, for Claude Desktop, etc.)' },
    { key: 'ws', icon: '🔗', label: 'WebSocket', desc: 'Connect via WebSocket (requires server running, for custom clients)' },
];

interface PlatformEntry {
    name: string;
    icon: string;
    instructions: (transport: TransportType) => string;
    setup: (transport: TransportType) => Promise<boolean>;
}

/** Normalize Windows backslashes to forward slashes to avoid escape issues */
function normPath(p: string): string {
    return p.replace(/\\/g, '/');
}

/** Detect if we're running from the dev repo directory */
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

/** Get the best CLI path: dev build if available, else global install, else null */
function resolveCliPath(): { cmd: string; args: string[] } | null {
    // Priority 1: running from dev repo
    const devPath = getDevCliPath();
    if (devPath) {
        return { cmd: 'node', args: [devPath, 'start:stdio'] };
    }
    // Priority 2: global npm install
    try {
        const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
        const cliPath = normPath(path.join(globalRoot, 'roblox-mcp-difz', 'dist', 'cli.js'));
        if (fs.existsSync(cliPath)) {
            return { cmd: 'node', args: [cliPath, 'start:stdio'] };
        }
    } catch { /* fall through */ }
    // Priority 3: npx fallback (slow, but works if globally registered)
    return { cmd: 'npx', args: ['roblox-mcp-difz', 'start:stdio'] };
}

/** Full stdio server config with `type: "stdio"` — required by Claude Code v2 */
function buildStdioConfig(): Record<string, any> {
    const resolved = resolveCliPath();
    return {
        mcpServers: {
            'roblox-mcp-difz': {
                type: 'stdio',
                command: resolved!.cmd,
                args: resolved!.args,
                env: {},
            },
        },
    };
}

const PLATFORMS: Record<string, PlatformEntry> = {
    'claude-code': {
        name: 'Claude Code',
        icon: '🤖',
        instructions: (t: TransportType): string => {
            if (t === 'stdio') return 'Registered via claude mcp add (stdio).';
            if (t === 'http') return 'Registered via claude mcp add (HTTP transport).';
            return 'Claude Code supports stdio or HTTP.';
        },
        setup: async (transport: TransportType): Promise<boolean> => {
            if (transport === 'stdio') {
                // Try claude mcp add first (official method)
                const resolved = resolveCliPath();
                if (!resolved) {
                    console.error('     Could not resolve server path');
                    return false;
                }
                const argsStr = resolved.args.map((a: string) =>
                    /^[A-Za-z0-9_./:@-]+$/.test(a) ? a : `"${a}"`
                ).join(' ');
                const claudeCmd = `claude mcp add roblox-mcp-difz -s user -- ${resolved.cmd} ${argsStr}`;

                try {
                    const result = execSync(claudeCmd, { stdio: 'pipe', timeout: 15000, windowsHide: true });
                    console.log(`     ${result.toString().trim().split('\n').pop()}`);
                    // Show the config that was written
                    const mcpPath = normPath(path.join(HOME, '.mcp.json'));
                    if (fs.existsSync(path.join(HOME, '.mcp.json'))) {
                        console.log(`     File: ${mcpPath}`);
                    }
                    return true;
                } catch (err: any) {
                    const msg = err.stderr?.toString() || err.message || '';
                    if (msg.includes('already exists') || msg.includes('Added')) {
                        return true;
                    }
                    // claude CLI failed — fall back to direct file write
                    console.error(`     claude CLI error: ${msg.trim().split('\n')[0]}`);
                    console.log('     Falling back to direct ~/.mcp.json write...');
                    const ok = writeConfigFile(
                        HOME,
                        path.join(HOME, '.mcp.json'),
                        buildStdioConfig(),
                    );
                    if (ok) {
                        console.log('     ✅ Config written directly to ~/.mcp.json');
                        console.log('     Run: claude mcp add roblox-mcp-difz -s user --transport stdio');
                    }
                    return ok;
                }
            } else {
                // HTTP transport — claude mcp add with --transport http
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
            }
        },
    },
    'claude-desktop': {
        name: 'Claude Desktop',
        icon: '💻',
        instructions: (t: TransportType): string => `Restart Claude Desktop. (${t})`,
        setup: async (transport: TransportType): Promise<boolean> =>
            writeConfigFile(
                path.join(HOME, 'AppData', 'Roaming', 'Claude'),
                path.join(HOME, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
                generateConfigForPlatform(transport),
            ),
    },
    'cursor': {
        name: 'Cursor',
        icon: '🔷',
        instructions: (t: TransportType): string => `Global config at ~/.cursor/mcp.json. (${t})`,
        setup: async (transport: TransportType): Promise<boolean> =>
            writeConfigFile(
                path.join(HOME, '.cursor'),
                path.join(HOME, '.cursor', 'mcp.json'),
                generateConfigForPlatform(transport),
            ),
    },
    'windsurf': {
        name: 'Windsurf',
        icon: '🏄',
        instructions: (t: TransportType): string => `Config at ~/.windsurf/mcp_config.json. (${t})`,
        setup: async (transport: TransportType): Promise<boolean> =>
            writeConfigFile(
                path.join(HOME, '.windsurf'),
                path.join(HOME, '.windsurf', 'mcp_config.json'),
                generateConfigForPlatform(transport),
            ),
    },
    'vscode': {
        name: 'VS Code (Cline / Continue)',
        icon: '📝',
        instructions: (t: TransportType): string => `Config at ~/.vscode/mcp.json. (${t})`,
        setup: async (transport: TransportType): Promise<boolean> =>
            writeConfigFile(
                path.join(HOME, '.vscode'),
                path.join(HOME, '.vscode', 'mcp.json'),
                generateConfigForPlatform(transport),
            ),
    },
    'generic': {
        name: 'Generic MCP Client',
        icon: '🔌',
        instructions: (t: TransportType): string => `Saved to CWD as mcp-config.json. (${t})`,
        setup: async (transport: TransportType): Promise<boolean> =>
            writeConfigFile(
                CWD,
                path.join(CWD, 'mcp-config.json'),
                generateConfigForPlatform(transport),
            ),
    },
};

function generateConfigForPlatform(transport: TransportType): Record<string, any> {
    if (transport === 'stdio') {
        return buildStdioConfig();
    } else if (transport === 'http') {
        return { mcpServers: { 'roblox-mcp-difz': { type: 'http', url: `http://localhost:${MCP_PORT}/mcp` } } };
    } else {
        return { mcpServers: { 'roblox-mcp-difz': { url: `ws://localhost:${MCP_PORT}/ws` } } };
    }
}

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

async function runSetupWizard(targetAI?: string, transportArg?: string): Promise<void> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║     Roblox MCP — Setup Menu                   ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');

    let transport: TransportType;
    if (transportArg && TRANSPORTS.some(t => t.key === transportArg)) {
        transport = transportArg as TransportType;
    } else if (targetAI === 'claude-code') {
        transport = 'stdio';
        console.log(`  → Transport: 🔌 STDIO (default for Claude Code)`);
    } else {
        console.log('  Select transport type:');
        console.log('');
        for (let i = 0; i < TRANSPORTS.length; i++) {
            console.log(`    ${i + 1}. ${TRANSPORTS[i].icon} ${TRANSPORTS[i].label} — ${TRANSPORTS[i].desc}`);
        }
        console.log('');
        const answer = await question(rl, '  Enter number (1-3) [default: 1]: ');
        const idx = parseInt(answer.trim(), 10) - 1;
        transport = (idx >= 0 && idx < TRANSPORTS.length) ? TRANSPORTS[idx].key : 'stdio';
    }
    console.log(`  → Selected: ${TRANSPORTS.find(t => t.key === transport)?.icon} ${transport.toUpperCase()}`);
    console.log('');

    let selectedKeys: string[] | null;
    if (targetAI) {
        const key = targetAI.toLowerCase().replace(/ /g, '-');
        if (PLATFORMS[key]) { selectedKeys = [key]; console.log(`  → Auto-setup for: ${PLATFORMS[key].icon} ${PLATFORMS[key].name}`); }
        else { console.log(`  ✗ Unknown AI: "${targetAI}".`); selectedKeys = null; }
    } else { selectedKeys = null; }

    if (!selectedKeys) {
        console.log('  Select AI platform(s) to configure:\n');
        const keys = Object.keys(PLATFORMS);
        for (let i = 0; i < keys.length; i++) console.log(`    ${i + 1}. ${PLATFORMS[keys[i]].icon} ${PLATFORMS[keys[i]].name}`);
        console.log('');
        const answer = await question(rl, '  Enter numbers (comma-separated, e.g. "1,3" or "all"): ');
        const trimmed = answer.trim().toLowerCase();
        if (trimmed === 'all') { selectedKeys = keys; }
        else {
            selectedKeys = [];
            for (const part of trimmed.split(',').map((s: string) => s.trim())) {
                const idx = parseInt(part, 10) - 1;
                if (idx >= 0 && idx < keys.length) selectedKeys.push(keys[idx]);
            }
        }
        if (selectedKeys.length === 0) { console.log('  No valid selection. Exiting.'); rl.close(); return; }
    }

    console.log('\n  Configuring...\n');
    let successCount = 0;
    for (const key of selectedKeys) {
        const platform = PLATFORMS[key];
        process.stdout.write(`  ${platform.icon} ${platform.name} (${transport.toUpperCase()})... `);
        const ok = await platform.setup(transport);
        console.log(ok ? `✅\n     ${platform.instructions(transport)}` : `❌`);
        console.log('');
        if (ok) successCount++;
    }

    console.log(`  Done! ${successCount}/${selectedKeys.length} config(s) created.\n`);
    if (selectedKeys.includes('claude-code') && transport === 'stdio') {
        const mcpJsonPath = normPath(path.join(HOME, '.mcp.json'));
        console.log('  Claude Code config:');
        console.log(`    File: ${mcpJsonPath}`);
        console.log('    Restart Claude Code or type "Reconnect" in the MCP menu.\n');
    }
    console.log('  Next steps:');
    const devPath = getDevCliPath();
    if (devPath) {
        console.log(`  1. Start server (dev): node ${devPath} start:stdio`);
        console.log(`     Or build + publish: npm run publish`);
    } else {
        console.log(`  1. Start server: roblox-mcp-difz start`);
        console.log(`  2. ${transport === 'stdio' ? 'Stdio mode: roblox-mcp-difz start:stdio' : `${transport.toUpperCase()}: ${transport === 'http' ? 'POST http://localhost:28429/mcp' : 'ws://localhost:28429/ws'}`}`);
    }
    console.log('  3. Check /type:  http://localhost:28429/type\n');
    rl.close();
}

module.exports = { runSetupWizard, PLATFORMS, TRANSPORTS };
