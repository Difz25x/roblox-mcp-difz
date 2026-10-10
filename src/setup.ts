const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const readline = require('readline');
const { installSkillToTarget } = require('./skill-installer');

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
        'roblox-difz': { type: 'http', url: `http://localhost:${MCP_PORT}/mcp` },
    },
};

interface PlatformDef {
    name: string;
    instructions: string;
    setup: () => Promise<string | undefined>;
}

const PLATFORMS: Record<string, PlatformDef> = {
    'claude-code': {
        name: 'Claude Code',
        instructions: 'Registered in user config. Skill saved to ~/.claude/skills/roblox-mcp.',
        setup: async () => {
            removeServerFromJson(path.join(HOME, '.mcp.json'), 'roblox-mcp-difz');
            try {
                const cmd = `claude mcp add roblox-mcp-difz -s user --transport http http://localhost:${MCP_PORT}/mcp`;
                const result = execSync(cmd, { stdio: 'pipe', timeout: 15000, windowsHide: true });
                console.log(`     ${result.toString().trim().split('\n').pop()}`);
            } catch (err: any) {
                const msg = err.stderr?.toString() || err.message || '';
                if (!msg.includes('already exists') && !msg.includes('Added')) {
                    throw new Error(msg.trim());
                }
            }
            try {
                installSkillToTarget('claude-code-global');
                installSkillToTarget('claude-code-project');
            } catch {}
            return undefined;
        },
    },
    'claude-desktop': {
        name: 'Claude Desktop',
        instructions: 'Restart Claude Desktop.',
        setup: async () => writeConfigFile(
            path.join(HOME, 'AppData', 'Roaming', 'Claude'),
            path.join(HOME, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
            HTTP_CONFIG,
        ),
    },
    'cursor': {
        name: 'Cursor',
        instructions: 'Restart Cursor. Rules saved to .cursor/rules/roblox-mcp.mdc.',
        setup: async () => {
            const res = writeConfigFile(
                path.join(HOME, '.cursor'),
                path.join(HOME, '.cursor', 'mcp.json'),
                HTTP_CONFIG,
            );
            try {
                installSkillToTarget('cursor-project');
                installSkillToTarget('cursor-global');
            } catch {}
            return res;
        },
    },
    'windsurf': {
        name: 'Windsurf',
        instructions: 'Restart Windsurf. Rules saved to .windsurf/rules/roblox-mcp.md.',
        setup: async () => {
            const res = writeConfigFile(
                path.join(HOME, '.windsurf'),
                path.join(HOME, '.windsurf', 'mcp_config.json'),
                HTTP_CONFIG,
            );
            try {
                installSkillToTarget('windsurf-project');
                installSkillToTarget('windsurf-global');
            } catch {}
            return res;
        },
    },
    'vscode': {
        name: 'VS Code (Cline / Continue)',
        instructions: 'Restart VS Code.',
        setup: async () => writeConfigFile(
            path.join(HOME, 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings'),
            path.join(HOME, 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'cline_mcp_settings.json'),
            HTTP_CONFIG,
        ),
    },
    'gemini-cli': {
        name: 'Gemini CLI',
        instructions: 'Restart Gemini CLI.',
        setup: async () => writeConfigFile(
            path.join(HOME, '.gemini'),
            path.join(HOME, '.gemini', 'mcp.json'),
            HTTP_CONFIG,
        ),
    },
    'codex-cli': {
        name: 'Codex CLI',
        instructions: 'Restart Codex CLI.',
        setup: async () => writeConfigFile(
            path.join(HOME, '.codex'),
            path.join(HOME, '.codex', 'mcp.json'),
            HTTP_CONFIG,
        ),
    },
    'antigravity-ide': {
        name: 'AntiGravity IDE',
        instructions: 'Restart AntiGravity IDE.',
        setup: async () => writeConfigFile(
            path.join(HOME, '.antigravity'),
            path.join(HOME, '.antigravity', 'mcp.json'),
            HTTP_CONFIG,
        ),
    },
    'antigravity-cli': {
        name: 'AntiGravity CLI',
        instructions: 'Restart AntiGravity CLI.',
        setup: async () => writeConfigFile(
            path.join(HOME, '.antigravity-cli'),
            path.join(HOME, '.antigravity-cli', 'mcp.json'),
            HTTP_CONFIG,
        ),
    },
    'rooo-code': {
        name: 'Roo Code',
        instructions: 'Restart Roo Code.',
        setup: async () => writeConfigFile(
            path.join(HOME, '.roocode'),
            path.join(HOME, '.roocode', 'mcp.json'),
            HTTP_CONFIG,
        ),
    },
    'zed': {
        name: 'Zed',
        instructions: 'Restart Zed.',
        setup: async () => writeConfigFile(
            path.join(HOME, '.config', 'zed'),
            path.join(HOME, '.config', 'zed', 'mcp.json'),
            HTTP_CONFIG,
        ),
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
            } catch (e: any) {}
        }
        fs.writeFileSync(configFile, JSON.stringify(merged, null, 2), 'utf-8');
        return configFile;
    } catch (err: any) {
        throw new Error(err.message);
    }
}

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
    name: string;
    checked: boolean;
}

function renderSetupMenu(items: SelectItem[], cursor: number): void {
    console.clear();
    hideCursor();

    const lines: string[] = [];
    lines.push(`  \x1b[1;36mRoblox MCP Setup\x1b[0m`);
    lines.push(`  \x1b[2mSelect editors and CLI tools\x1b[0m`);
    lines.push('');

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const check = item.checked ? '\x1b[32m[*]\x1b[0m' : '[ ]';
        const pointer = i === cursor ? '\x1b[36m>\x1b[0m' : ' ';
        if (i === cursor) {
            lines.push(`  ${pointer} ${check} \x1b[1m${item.name}\x1b[0m`);
        } else {
            lines.push(`  ${pointer} ${check} \x1b[2m${item.name}\x1b[0m`);
        }
    }

    lines.push('');
    lines.push(`  \x1b[2m[Up/Down] Navigate  [Space] Toggle  [A] Select All  [Enter] Confirm\x1b[0m`);

    for (const line of lines) {
        process.stdout.write('\r\x1b[K' + line + '\n');
    }
}

function interactiveSelectPlatforms(): Promise<string[]> {
    return new Promise((resolve) => {
        const keys = Object.keys(PLATFORMS);
        const items: SelectItem[] = keys.map(key => ({
            key,
            name: PLATFORMS[key].name,
            checked: false,
        }));

        let cursor = 0;

        clearScreen();
        renderSetupMenu(items, cursor);

        if (!process.stdin.isTTY) {
            showCursor();
            resolve(keys);
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
            if (key.ctrl && key.name === 'c') {
                cleanup();
                clearScreen();
                resolve([]);
                return;
            }

            if (key.name === 'up' || key.name === 'k') {
                cursor = (cursor - 1 + items.length) % items.length;
                renderSetupMenu(items, cursor);
                return;
            }

            if (key.name === 'down' || key.name === 'j') {
                cursor = (cursor + 1) % items.length;
                renderSetupMenu(items, cursor);
                return;
            }

            if (key.name === 'space' || str === ' ') {
                items[cursor].checked = !items[cursor].checked;
                renderSetupMenu(items, cursor);
                return;
            }

            if (key.name === 'a' || str === 'a' || str === 'A') {
                const allChecked = items.every(i => i.checked);
                for (const item of items) item.checked = !allChecked;
                renderSetupMenu(items, cursor);
                return;
            }

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
            console.log(`  Configuring ${PLATFORMS[key].name}...`);
        } else {
            console.log(`  Unknown platform: "${targetAI}"`);
            return;
        }
    } else {
        selectedKeys = await interactiveSelectPlatforms();
        if (selectedKeys.length === 0) {
            console.log('  No platforms selected.');
            return;
        }
    }

    clearScreen();
    console.log('  Writing MCP configurations...\n');

    let successCount = 0;
    for (const key of selectedKeys) {
        const platform = PLATFORMS[key];
        process.stdout.write(`  ${platform.name}... `);
        try {
            const resultPath = await platform.setup();
            console.log(`[OK]`);
            if (resultPath) {
                console.log(`     File: ${normPath(typeof resultPath === 'string' ? resultPath : '')}`);
            }
            console.log(`     ${platform.instructions}`);
            successCount++;
        } catch (err: any) {
            console.log(`[FAIL]`);
            console.log(`     Error: ${err.message}`);
        }
    }

    console.log(`\n  Configured ${successCount} of ${selectedKeys.length} platforms.\n`);

    const devPath = getDevCliPath();
    const startCmd = devPath ? `node ${devPath} start` : 'rblx-mcp start';
    console.log(`  Start server: ${startCmd}`);
    console.log(`  Inject script: loadstring(game:HttpGet("http://127.0.0.1:${MCP_PORT}/mcp.lua"))()`);
}

module.exports = { runSetupWizard, PLATFORMS };
