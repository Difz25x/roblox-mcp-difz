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

interface PlatformDef {
    name: string;
    icon: string;
    instructions: string;
    setup: () => Promise<boolean | string>;
}

const PLATFORMS: Record<string, PlatformDef> = {
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
        instructions: 'Restart Cursor IDE.',
        setup: async () => writeConfigFile(
            path.join(HOME, '.cursor'),
            path.join(HOME, '.cursor', 'mcp.json'),
            HTTP_CONFIG,
        ),
    },
    'windsurf': {
        name: 'Windsurf', icon: '🏄',
        instructions: 'Restart Windsurf.',
        setup: async () => writeConfigFile(
            path.join(HOME, '.windsurf'),
            path.join(HOME, '.windsurf', 'mcp_config.json'),
            HTTP_CONFIG,
        ),
    },
    'vscode': {
        name: 'VS Code (Cline / Continue)', icon: '📝',
        instructions: 'Restart VS Code.',
        setup: async () => writeConfigFile(
            path.join(HOME, 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings'),
            path.join(HOME, 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'cline_mcp_settings.json'),
            HTTP_CONFIG,
        ),
    },
    'gemini-cli': {
        name: 'Gemini CLI', icon: '✨',
        instructions: 'Run gemini CLI again.',
        setup: async () => writeConfigFile(
            path.join(HOME, '.gemini'),
            path.join(HOME, '.gemini', 'mcp.json'),
            HTTP_CONFIG,
        ),
    },
    'codex-cli': {
        name: 'Codex CLI', icon: '🧠',
        instructions: 'Run codex CLI again.',
        setup: async () => writeConfigFile(
            path.join(HOME, '.codex'),
            path.join(HOME, '.codex', 'mcp.json'),
            HTTP_CONFIG,
        ),
    },
    'antigravity-ide': {
        name: 'AntiGravity IDE', icon: '🚀',
        instructions: 'Restart AntiGravity IDE.',
        setup: async () => writeConfigFile(
            path.join(HOME, '.antigravity'),
            path.join(HOME, '.antigravity', 'mcp.json'),
            HTTP_CONFIG,
        ),
    },
    'antigravity-cli': {
        name: 'AntiGravity CLI', icon: '🛸',
        instructions: 'Run antigravity CLI again.',
        setup: async () => writeConfigFile(
            path.join(HOME, '.antigravity-cli'),
            path.join(HOME, '.antigravity-cli', 'mcp.json'),
            HTTP_CONFIG,
        ),
    },
    'roo-code': {
        name: 'Roo Code', icon: '🦘',
        instructions: 'Restart Roo Code.',
        setup: async () => writeConfigFile(
            path.join(HOME, '.roocode'),
            path.join(HOME, '.roocode', 'mcp.json'),
            HTTP_CONFIG,
        ),
    },
    'zed': {
        name: 'Zed', icon: '⚡',
        instructions: 'Restart Zed Editor.',
        setup: async () => writeConfigFile(
            path.join(HOME, '.config', 'zed'),
            path.join(HOME, '.config', 'zed', 'mcp.json'),
            HTTP_CONFIG,
        ),
    },
    'generic': {
        name: 'Generic MCP Client', icon: '🔌',
        instructions: 'Saved to CWD as mcp-config.json.',
        setup: async () => writeConfigFile(CWD, path.join(CWD, 'mcp-config.json'), HTTP_CONFIG),
    },
};

function writeConfigFile(configDir: string, configFile: string, config: Record<string, any>): string {
    try {
        fs.mkdirSync(configDir, { recursive: true });
        let merged = config;
        if (fs.existsSync(configFile)) {
            try {
                const existing = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
                merged = { ...existing, mcpServers: { ...(existing.mcpServers || {}), ...config.mcpServers } };
            } catch (e: any) {
                // Ignore parse errors, just overwrite
            }
        }
        fs.writeFileSync(configFile, JSON.stringify(merged, null, 2), 'utf-8');
        return configFile;
    } catch (err: any) {
        throw new Error(err.message);
    }
}

// ── Interactive multi-select for platform picker ────────────────────

function clearScreen(): void {
    console.clear();
}

function hideCursor(): void {
    process.stdout.write('\x1b[?25l');
}

function showCursor(): void {
    process.stdout.write('\x1b[?25h');
}

interface SelectItem {
    key: string;
    icon: string;
    name: string;
    checked: boolean;
}

let _setupLineCount = 0;

function renderSetupMenu(items: SelectItem[], cursor: number, isFirstRender: boolean = false): void {
    hideCursor();

    const lines: string[] = [];
    lines.push(`  \x1b[1;36mRoblox MCP — Setup Wizard\x1b[0m`);
    lines.push(`  \x1b[2mSelect platforms (Space to toggle, Enter to confirm)\x1b[0m`);
    lines.push('');

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const check = item.checked ? '\x1b[32m✔\x1b[0m' : ' ';
        const pointer = i === cursor ? '\x1b[36m❯\x1b[0m' : ' ';
        if (i === cursor) {
            lines.push(`  ${pointer} [${check}] ${item.icon}  \x1b[1m${item.name}\x1b[0m`);
        } else {
            lines.push(`  ${pointer} [${check}] ${item.icon}  \x1b[2m${item.name}\x1b[0m`);
        }
    }

    lines.push('');
    lines.push(`  \x1b[2m↑↓ Navigate  Space Toggle  A All  ⏎ Confirm\x1b[0m`);

    if (!isFirstRender && _setupLineCount > 0) {
        readline.moveCursor(process.stdout, 0, -_setupLineCount);
    }

    for (const line of lines) {
        process.stdout.write('\r\x1b[K' + line + '\n');
    }
    _setupLineCount = lines.length;
}

function interactiveSelectPlatforms(): Promise<string[]> {
    return new Promise((resolve) => {
        const keys = Object.keys(PLATFORMS);
        const items: SelectItem[] = keys.map(key => ({
            key,
            icon: PLATFORMS[key].icon,
            name: PLATFORMS[key].name,
            checked: false,
        }));

        let cursor = 0;

        clearScreen();
        _setupLineCount = 0;
        renderSetupMenu(items, cursor, true);

        if (!process.stdin.isTTY) {
            showCursor();
            resolve(keys); // non-TTY: select all
            return;
        }

        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);
        process.stdin.resume();

        const cleanup = () => {
            showCursor();
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeAllListeners('keypress');
        };

        process.stdin.on('keypress', (str: string, key: any) => {
            // Ctrl+C
            if (key.ctrl && key.name === 'c') {
                cleanup();
                clearScreen();
                resolve([]);
                return;
            }

            // Up
            if (key.name === 'up' || key.name === 'k') {
                cursor = (cursor - 1 + items.length) % items.length;
                renderSetupMenu(items, cursor);
                return;
            }

            // Down
            if (key.name === 'down' || key.name === 'j') {
                cursor = (cursor + 1) % items.length;
                renderSetupMenu(items, cursor);
                return;
            }

            // Space — toggle
            if (key.name === 'space' || str === ' ') {
                items[cursor].checked = !items[cursor].checked;
                renderSetupMenu(items, cursor);
                return;
            }

            // A/a — toggle all
            if (key.name === 'a' || str === 'a' || str === 'A') {
                const allChecked = items.every(i => i.checked);
                for (const item of items) item.checked = !allChecked;
                renderSetupMenu(items, cursor);
                return;
            }

            // Enter — confirm
            if (key.name === 'return' || key.name === 'enter') {
                cleanup();
                const selected = items.filter(i => i.checked).map(i => i.key);
                resolve(selected);
                return;
            }
        });
    });
}

async function runSetupWizard(targetAI?: string | null): Promise<void> {
    let selectedKeys: string[];

    if (targetAI) {
        const key = targetAI.toLowerCase().replace(/ /g, '-');
        if (PLATFORMS[key]) {
            selectedKeys = [key];
            clearScreen();
            console.log(`  Auto-setup: ${PLATFORMS[key].icon} ${PLATFORMS[key].name}`);
        } else {
            console.log(`  \x1b[33m⚠ Unknown AI: "${targetAI}"\x1b[0m`);
            return;
        }
    } else {
        selectedKeys = await interactiveSelectPlatforms();
        if (selectedKeys.length === 0) {
            console.log('  \x1b[2mNo platforms selected.\x1b[0m');
            return;
        }
    }

    clearScreen();
    console.log('  \x1b[1m⚙️  Configuring (HTTP)...\x1b[0m\n');

    let successCount = 0;
    for (const key of selectedKeys) {
        const platform = PLATFORMS[key];
        process.stdout.write(`  ${platform.icon} ${platform.name}... `);
        try {
            const resultPath = await platform.setup();
            console.log(`✅`);
            if (resultPath) {
                console.log(`     \x1b[2mFile: ${normPath(typeof resultPath === 'string' ? resultPath : '')}\x1b[0m`);
            }
            console.log(`     \x1b[2m${platform.instructions}\x1b[0m`);
            successCount++;
        } catch (err: any) {
            console.log(`❌`);
            console.log(`     \x1b[31mError: ${err.message}\x1b[0m`);
        }
    }

    console.log(`\n  \x1b[1m✔ Done! ${successCount}/${selectedKeys.length} configured.\x1b[0m\n`);

    const devPath = getDevCliPath();
    const startCmd = devPath ? `node ${devPath} start` : 'rblx-mcp start';
    console.log(`  \x1b[2mStart:\x1b[0m  ${startCmd}`);
    console.log(`  \x1b[2mInject:\x1b[0m loadstring(game:HttpGet("http://127.0.0.1:${MCP_PORT}/mcp.lua"))()`);
}

module.exports = { runSetupWizard, PLATFORMS };
