#!/usr/bin/env node

const PKG = require('../package.json');
const { spawn, spawnSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

import * as readline from 'readline';

const { DiscoveryServer, getDiscoveryPort } = require('./discovery-server');

const CONFIG_DIR = path.join(os.homedir(), '.roblox-mcp');
try { if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true }); } catch {}
const PID_FILE = path.join(CONFIG_DIR, 'server.pid');
const DEFAULT_PORT = 28429;

function getPort(): number {
    for (let i = 0; i < process.argv.length; i++) {
        const arg = process.argv[i];
        if (arg === '--port' || arg === '-p') {
            const val = parseInt(process.argv[i + 1], 10);
            if (!isNaN(val) && val > 0 && val <= 65535) return val;
        } else if (arg.startsWith('--port=')) {
            const val = parseInt(arg.slice(7), 10);
            if (!isNaN(val) && val > 0 && val <= 65535) return val;
        }
    }
    const envVal = parseInt(process.env.MCP_PORT!, 10);
    if (!isNaN(envVal) && envVal > 0 && envVal <= 65535) return envVal;

    try {
        const cfgPath = path.join(CONFIG_DIR, 'config.json');
        if (fs.existsSync(cfgPath)) {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
            if (cfg.port && !isNaN(cfg.port) && cfg.port > 0 && cfg.port <= 65535) {
                return cfg.port;
            }
        }
    } catch {}

    return DEFAULT_PORT;
}

// ── Helpers ─────────────────────────────────────────

function hideCursor(): void { process.stdout.write('\x1b[?25l'); }
function showCursor(): void { process.stdout.write('\x1b[?25h'); }

function printBanner(port: number, toolsCount: number, wsCount: number, pid: number, discoveryPort?: number): void {
    console.log(`  \x1b[1;36mRoblox MCP Server\x1b[0m \x1b[2mv${PKG.version}\x1b[0m`);
    console.log(`  HTTP      http://localhost:${port}/mcp`);
    console.log(`  WS        ws://localhost:${port}/ws`);
    if (discoveryPort) {
        console.log(`  Discovery http://localhost:${discoveryPort}/port`);
    }
    console.log(`  Tools ${toolsCount}  Conns ${wsCount}  PID ${pid}`);
    console.log(`  \x1b[2mInject: loadstring(game:HttpGet("http://127.0.0.1:${port}/mcp.lua"))()\x1b[0m`);
    if (discoveryPort && discoveryPort !== port) {
        console.log(`  \x1b[2mAuto-sync: loadstring(game:HttpGet("http://127.0.0.1:${discoveryPort}/mcp.lua"))()\x1b[0m`);
    }
}

// ── Interactive menu renderer (no scroll bug) ───────

interface MenuItem {
    label: string;
    icon: string;
    description: string;
    action: () => Promise<void>;
}

let _menuLineCount = 0;

function renderMenu(items: MenuItem[], selected: number): void {
    console.clear();
    hideCursor();
    const lines: string[] = [];
    lines.push(`  \x1b[1;36m${PKG.name}\x1b[0m \x1b[2mv${PKG.version}\x1b[0m`);
    lines.push('');
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (i === selected) {
            lines.push(`  \x1b[36m❯ ${item.icon}  ${item.label}\x1b[0m  \x1b[2m${item.description}\x1b[0m`);
        } else {
            lines.push(`    ${item.icon}  \x1b[2m${item.label}\x1b[0m`);
        }
    }
    lines.push('');
    lines.push(`  \x1b[2m↑↓ Navigate  ⏎ Select  Ctrl+C Exit\x1b[0m`);


    for (const line of lines) {
        process.stdout.write('\r\x1b[K' + line + '\n');
    }
    _menuLineCount = lines.length;
}

// ── Confirm prompt (Y/N) ────────────────────────────

function confirm(message: string): Promise<boolean> {
    return new Promise((resolve) => {
        showCursor();
        process.stdout.write(`  ${message} \x1b[2m(y/n)\x1b[0m `);
        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.once('keypress', (_str: string, key: any) => {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeAllListeners('keypress');
            const yes = key?.name === 'y' || _str === 'y' || _str === 'Y';
            console.log(yes ? 'yes' : 'no');
            resolve(yes);
        });
    });
}

// ── Fetch latest version ────────────────────────────

function fetchLatestVersion(): Promise<string | null> {
    return new Promise((resolve) => {
        const req = https.get(`https://registry.npmjs.org/${PKG.name}/latest`, {
            headers: { 'Accept': 'application/json' },
            timeout: 5000,
        }, (res: any) => {
            let data = '';
            res.on('data', (chunk: string) => { data += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(data).version || null); }
                catch { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

// ── Commands ────────────────────────────────────────

async function cmdUpdate(): Promise<void> {
    console.log(`  \x1b[1m🔄 Checking for updates...\x1b[0m`);
    const latest = await fetchLatestVersion();

    if (!latest) {
        console.log(`  \x1b[33m⚠ Could not reach npm registry.\x1b[0m`);
        return;
    }
    if (latest === PKG.version) {
        console.log(`  \x1b[32m✔ Already on latest (v${PKG.version})\x1b[0m`);
        return;
    }

    console.log(`  \x1b[33mNew version: v${PKG.version} → v${latest}\x1b[0m`);
    const yes = await confirm('Update now?');
    if (!yes) {
        console.log(`  \x1b[2mSkipped.\x1b[0m`);
        return;
    }

    console.log(`  Updating...`);
    try {
        const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        const res = spawnSync(npmCmd, ['install', '-g', `${PKG.name}@latest`], {
            stdio: 'inherit',
            timeout: 60000,
            windowsHide: true,
        });
        if (res.status !== 0) {
            throw new Error(`npm exited with status code ${res.status}`);
        }
        console.log(`  \x1b[32m✔ Updated to v${latest}!\x1b[0m`);

        console.log(`  \x1b[2mRelaunching...\x1b[0m`);

        // Auto relaunch in the exact same terminal
        const child = spawn(process.execPath, [__filename], {
            stdio: 'inherit',
            detached: false
        });

        child.on('exit', (code: number | null) => {
            process.exit(code || 0);
        });
        return; // wait for the new process instead of exiting immediately
    } catch (err: any) {
        console.error(`  \x1b[31m✖ Update failed: ${err.message}\x1b[0m`);
    }
}

let _activeServer: any = null;
let _discoveryServer: any = null;

function getPidOnPort(port: number): number | null {
    if (process.platform === 'win32') {
        const res = spawnSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf-8', windowsHide: true });
        if (res.status === 0 && res.stdout) {
            const lines = res.stdout.split('\n');
            for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line.startsWith('TCP')) continue;
                const parts = line.split(/\s+/);
                if (parts.length >= 5 && parts[3] === 'LISTENING') {
                    const localAddr = parts[1];
                    const pidStr = parts[4];
                    if (localAddr.endsWith(`:${port}`) || localAddr.endsWith(`.${port}`)) {
                        const pid = parseInt(pidStr, 10);
                        if (!isNaN(pid) && pid > 0 && pid !== process.pid) {
                            return pid;
                        }
                    }
                }
            }
        }
    } else {
        const res = spawnSync('lsof', ['-ti', `:${port}`], { encoding: 'utf-8' });
        if (res.status === 0 && res.stdout) {
            const pids = res.stdout.trim().split(/\s+/).map((p: string) => parseInt(p, 10)).filter((p: number) => !isNaN(p) && p > 0 && p !== process.pid);
            if (pids.length > 0) return pids[0];
        }
    }
    return null;
}

function killProcessByPid(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
    try {
        if (process.platform === 'win32') {
            spawnSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
        } else {
            process.kill(pid, 'SIGKILL');
        }
        return true;
    } catch {
        return false;
    }
}

async function ensurePortAvailable(port: number): Promise<void> {
    // 1. Check PID recorded in PID file
    if (fs.existsSync(PID_FILE)) {
        try {
            const recordedPid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
            if (!isNaN(recordedPid) && recordedPid > 0 && recordedPid !== process.pid) {
                killProcessByPid(recordedPid);
                try { fs.unlinkSync(PID_FILE); } catch {}
            }
        } catch {}
    }

    // 2. Check if any process is actively listening on this port
    let conflictingPid = getPidOnPort(port);
    if (conflictingPid) {
        console.log(`  \x1b[33m⚠ Port ${port} is occupied by an existing host (PID ${conflictingPid}).\x1b[0m`);
        console.log(`  \x1b[33m⚡ Terminating previous host and freeing port...\x1b[0m`);
        killProcessByPid(conflictingPid);

        // Wait up to 3 seconds for OS socket release
        const start = Date.now();
        while (Date.now() - start < 3000) {
            await new Promise(r => setTimeout(r, 200));
            conflictingPid = getPidOnPort(port);
            if (!conflictingPid) break;
        }

        if (conflictingPid) {
            killProcessByPid(conflictingPid);
            await new Promise(r => setTimeout(r, 300));
        }

        console.log(`  \x1b[32m✔ Previous host terminated. Port ${port} is now available.\x1b[0m\n`);
    }
}

function startListening(server: any, port: number, onListening: () => Promise<void> | void): Promise<void> {
    return new Promise((resolve, reject) => {
        let isResolved = false;

        const onError = async (err: any) => {
            if (err.code === 'EADDRINUSE') {
                console.log(`  \x1b[33m⚠ Port ${port} is currently busy (EADDRINUSE). Forcing release...\x1b[0m`);
                const pid = getPidOnPort(port);
                if (pid) {
                    killProcessByPid(pid);
                    await new Promise(r => setTimeout(r, 400));
                }
                try {
                    server.close();
                } catch {}

                server.once('error', (retryErr: any) => {
                    if (!isResolved) {
                        isResolved = true;
                        reject(retryErr);
                    }
                });

                server.listen(port, async () => {
                    if (!isResolved) {
                        isResolved = true;
                        await onListening();
                        resolve();
                    }
                });
            } else {
                if (!isResolved) {
                    isResolved = true;
                    reject(err);
                }
            }
        };

        server.once('error', onError);
        server.listen(port, async () => {
            if (!isResolved) {
                isResolved = true;
                server.removeListener('error', onError);
                await onListening();
                resolve();
            }
        });
    });
}

async function cmdStart(isDaemon: boolean = false): Promise<void> {
    const PORT = getPort();
    const DISCOVERY_PORT = getDiscoveryPort();

    await ensurePortAvailable(PORT);
    if (DISCOVERY_PORT !== PORT) {
        await ensurePortAvailable(DISCOVERY_PORT);
    }

    const { createApp } = require('./server-core');
    const { server, tools, wss } = createApp();

    _activeServer = server;

    await startListening(server, PORT, async () => {
        const pid = process.pid;

        // Write PID file for stop command
        try { fs.writeFileSync(PID_FILE, String(pid), 'utf-8'); } catch {}

        // Launch Discovery Server so mcp.lua can auto-sync to this custom port
        if (DISCOVERY_PORT !== PORT) {
            _discoveryServer = new DiscoveryServer({
                activePort: PORT,
                discoveryPort: DISCOVERY_PORT,
                onStopRequest: () => {
                    cleanupPidFile();
                    if (_activeServer) {
                        try { _activeServer.close(); } catch {}
                    }
                }
            });
            await _discoveryServer.start();
        }

        if (isDaemon) {
            // Background process mode — start the tray and keep process alive
            await startTray(PORT, pid);
        } else {
            // Normal foreground mode
            console.clear();
            printBanner(PORT, tools.count, wss.connectedCount, pid, DISCOVERY_PORT !== PORT ? DISCOVERY_PORT : undefined);
            console.log('');
            showPostStartMenu(PORT, pid);
        }
    });
}

async function cmdStdio(): Promise<void> {
    let createApp: any;
    let initMcpServer: any;
    let StdioServerTransport: any;

    try {
        ({ createApp } = require('./server-core'));
        ({ initMcpServer, StdioServerTransport } = require('./mcp-server'));
    } catch (err: any) {
        process.stderr.write(`  \x1b[31m✖ Cannot start MCP stdio transport: ${err.message}\x1b[0m\n`);
        process.stderr.write(`  \x1b[2mInstall dependencies first: npm install\x1b[0m\n`);
        process.exit(1);
    }

    const PORT = getPort();
    const DISCOVERY_PORT = getDiscoveryPort();

    await ensurePortAvailable(PORT);
    if (DISCOVERY_PORT !== PORT) {
        await ensurePortAvailable(DISCOVERY_PORT);
    }

    const { server, queue, tools, sessions, processManager } = createApp();

    const mcpServer = initMcpServer(queue, tools, sessions, processManager);
    await mcpServer.connect(new StdioServerTransport());

    if (DISCOVERY_PORT !== PORT) {
        _discoveryServer = new DiscoveryServer({
            activePort: PORT,
            discoveryPort: DISCOVERY_PORT,
            onStopRequest: () => {
                cleanupPidFile();
                if (_activeServer) {
                    try { _activeServer.close(); } catch {}
                }
            }
        });
        await _discoveryServer.start();
    }

    await startListening(server, PORT, () => {
        process.stderr.write(`  \x1b[2m[rblx-mcp] MCP stdio transport ready — WS/HTTP listening on port ${PORT} (discovery: ${DISCOVERY_PORT})\x1b[0m\n`);
    });
}

function showPostStartMenu(port: number, pid: number): void {
    const items: MenuItem[] = [
        {
            label: 'Hide in Tray',
            icon: '📌',
            description: 'Run in background with tray icon',
            action: async () => { await hideInTray(port, pid); },
        },
        {
            label: 'Open Dashboard',
            icon: '🌐',
            description: `http://localhost:${port}`,
            action: async () => {
                const url = `http://localhost:${port}`;
                if (process.platform === 'win32') {
                    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
                }
                console.log(`  \x1b[2mOpened ${url}\x1b[0m`);
            },
        },
        {
            label: 'Manage Processes',
            icon: '🛠️',
            description: 'Restart or kill Roblox',
            action: async () => {
                if (process.stdin.isTTY) {
                    process.stdin.setRawMode(false);
                    process.stdin.pause();
                    process.stdin.removeAllListeners('keypress');
                }
                await manageProcessesMenu(() => showPostStartMenu(port, pid));
            },
        },
        {
            label: 'Stop Server',
            icon: '⏹️',
            description: 'Shutdown and exit',
            action: async () => {
                cleanupPidFile();
                console.log(`  \x1b[2mStopped.\x1b[0m`);
                process.exit(0);
            },
        },
    ];

    let selected = 0;
    _menuLineCount = 0;
    renderMenu(items, selected);

    if (!process.stdin.isTTY) return;

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const cleanup = () => {
        showCursor();
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeAllListeners('keypress');
    };

    process.stdin.on('keypress', async (_str: string, key: any) => {
        if (!key) return;
        if (key.ctrl && key.name === 'c') {
            cleanup();
            cleanupPidFile();
            console.log('\n  \x1b[2mBye!\x1b[0m');
            process.exit(0);
        }
        if (key.name === 'up') {
            selected = (selected - 1 + items.length) % items.length;
            renderMenu(items, selected);
            return;
        }
        if (key.name === 'down') {
            selected = (selected + 1) % items.length;
            renderMenu(items, selected);
            return;
        }
        if (key.name === 'return') {
            cleanup();
            console.clear();
            try { await items[selected].action(); }
            catch (err: any) { console.error(`  \x1b[31m✖ ${err.message}\x1b[0m`); }
            if (items[selected].label === 'Open Dashboard') {
                showPostStartMenu(port, pid);
            } else if (items[selected].label !== 'Hide in Tray' && items[selected].label !== 'Stop Server') {
                console.log(`
  [2mPress any key...[0m`);
                readline.emitKeypressEvents(process.stdin);
                process.stdin.setRawMode(true);
                process.stdin.resume();
                process.stdin.once('keypress', () => {
                    process.stdin.setRawMode(false);
                    process.stdin.pause();
                    process.stdin.removeAllListeners('keypress');
                    showPostStartMenu(port, pid);
                });
            }
        }
    });
}

// ── Tray ────────────────────────────────────────────

let _isHandingOverToDaemon = false;

async function hideInTray(port: number, oldPid: number): Promise<void> {
    console.clear();
    console.log(`  \x1b[1m📌 Handing over to background daemon...\x1b[0m`);

    try {
        _isHandingOverToDaemon = true;

        // Close the current server so the daemon can bind to the port
        if (_activeServer) {
            await new Promise<void>(resolve => {
                // Force close all idle and active connections immediately (Node 18+)
                if (typeof _activeServer.closeAllConnections === 'function') {
                    _activeServer.closeAllConnections();
                }
                
                // Fallback timeout in case close takes too long
                const timeout = setTimeout(() => {
                    resolve();
                }, 500);

                _activeServer.close(() => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
        }

        // Use __filename to ensure we spawn the compiled JS (dist/cli.js) and not a dynamic dev path
        const scriptPath = __filename;
        const logPath = path.join(CONFIG_DIR, 'daemon.log');
        const out = fs.openSync(logPath, 'a');

        const child = spawn(process.execPath, [scriptPath, 'daemon'], {
            detached: true,
            stdio: ['ignore', out, out],
            windowsHide: true
        });

        child.unref();

        console.log(`  \x1b[32m✔\x1b[0m Server handed over to background daemon (PID ${child.pid})`);
        console.log(`  \x1b[2mRight-click the tray icon to manage it.\x1b[0m\n`);

        process.exit(0);
    } catch (err: any) {
        console.error(`  \x1b[31m✖ Failed to spawn daemon: ${err.message}\x1b[0m`);
    }
}

async function startTray(port: number, pid: number): Promise<void> {
    let SysTray: any;
    try {
        SysTray = require('systray2').default || require('systray2');
    } catch {
        // If not installed, just run silently in background
        return;
    }

    // Find icon
    let icon = '';
    const icoPath = path.join(__dirname, '..', 'public', 'icon.ico');
    const pngPath = path.join(__dirname, '..', 'public', 'icon.png');
    if (process.platform === 'win32' && fs.existsSync(icoPath)) {
        icon = fs.readFileSync(icoPath).toString('base64');
    } else if (fs.existsSync(pngPath)) {
        icon = fs.readFileSync(pngPath).toString('base64');
    }

    const itemDashboard = {
        title: 'Open Dashboard',
        tooltip: `http://localhost:${port}`,
        checked: false,
        enabled: true,
    };

    const itemStop = {
        title: 'Stop Server',
        tooltip: 'Stop and exit',
        checked: false,
        enabled: true,
    };

    const systray = new SysTray({
        menu: {
            icon: icon,
            title: '',
            tooltip: `Roblox MCP v${PKG.version} — port ${port}`,
            items: [itemDashboard, SysTray.separator || { title: '<SEPARATOR>', tooltip: '', checked: false, enabled: true }, itemStop],
        },
        debug: false,
        copyDir: false,
    });

    systray.onClick((action: any) => {
        if (action.item === itemDashboard) {
            const url = `http://localhost:${port}`;
            if (process.platform === 'win32') {
                spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
            }
        }
        if (action.item === itemStop) {
            cleanupPidFile();
            systray.kill(false);
            process.exit(0);
        }
    });

    try {
        await systray.ready();
    } catch (err: any) {}
}

// ── Stop command ────────────────────────────────────

async function cmdStop(): Promise<void> {
    const PORT = getPort();
    let stoppedAny = false;

    if (fs.existsSync(PID_FILE)) {
        const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
        if (!isNaN(pid)) {
            if (killProcessByPid(pid)) {
                console.log(`  \x1b[32m✔\x1b[0m Stopped server from PID file (PID ${pid})`);
                stoppedAny = true;
            }
        }
        cleanupPidFile();
    }

    const portPid = getPidOnPort(PORT);
    if (portPid) {
        if (killProcessByPid(portPid)) {
            console.log(`  \x1b[32m✔\x1b[0m Stopped server listening on port ${PORT} (PID ${portPid})`);
            stoppedAny = true;
        }
    }

    const DISCOVERY_PORT = getDiscoveryPort();
    if (DISCOVERY_PORT !== PORT) {
        const discPid = getPidOnPort(DISCOVERY_PORT);
        if (discPid && discPid !== portPid) {
            if (killProcessByPid(discPid)) {
                console.log(`  \x1b[32m✔\x1b[0m Stopped discovery server on port ${DISCOVERY_PORT} (PID ${discPid})`);
                stoppedAny = true;
            }
        }
    }

    if (!stoppedAny) {
        console.log(`  \x1b[33m⚠ No running server found on port ${PORT}.\x1b[0m`);
    }
}

function cleanupPidFile(): void {
    try { fs.unlinkSync(PID_FILE); } catch {}
}

// ── Setup ───────────────────────────────────────────

async function cmdSetup(): Promise<void> {
    const { runSetupWizard } = require('./setup');
    await runSetupWizard(null);
}

// ── Main menu ───────────────────────────────────────

async function manageProcessesMenu(parentMenuFn: () => void): Promise<void> {
    const { listRobloxProcesses, killProcess, launchRoblox } = require('./process-manager');
    const procs = listRobloxProcesses();

    if (procs.length === 0) {
        console.clear();
        console.log(`  \x1b[33mNo Roblox processes found.\x1b[0m\n`);
        console.log(`  \x1b[2mPress any key to return...\x1b[0m`);

        await new Promise<void>((resolve) => {
            readline.emitKeypressEvents(process.stdin);
            if (process.stdin.isTTY) process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.once('keypress', () => {
                if (process.stdin.isTTY) process.stdin.setRawMode(false);
                process.stdin.pause();
                process.stdin.removeAllListeners('keypress');
                parentMenuFn();
                resolve();
            });
        });
        return;
    }

    const items: MenuItem[] = procs.map((p: any) => ({
        label: p.windowTitle || p.name,
        icon: '🎮',
        description: `PID: ${p.pid} | Mem: ${p.memoryMB}MB`,
        action: async () => {
            const actionItems: MenuItem[] = [
                {
                    label: 'Restart', icon: '🔄', description: 'Kill and restart',
                    action: async () => {
                        killProcess(p.pid);
                        await new Promise<void>(r => setTimeout(r, 1000));
                        launchRoblox();
                        console.log('  \x1b[32mProcess restarted.\x1b[0m');
                    }
                },
                {
                    label: 'Kill', icon: '💀', description: 'Force kill process',
                    action: async () => {
                        killProcess(p.pid);
                        console.log('  \x1b[32mProcess killed.\x1b[0m');
                    }
                },
                {
                    label: 'Cancel', icon: '↩️', description: 'Go back',
                    action: async () => {}
                }
            ];

            return new Promise<void>((resolve) => {
                let actSelected = 0;
                let actLineCount = 0;

                const renderActMenu = () => {
                    hideCursor();
                    console.clear();
                    const lines = [`  \x1b[1;36mManage Process\x1b[0m \x1b[2m${p.pid}\x1b[0m`, ''];
                    for (let i = 0; i < actionItems.length; i++) {
                        const item = actionItems[i];
                        if (i === actSelected) lines.push(`  \x1b[36m❯ ${item.icon}  ${item.label}\x1b[0m  \x1b[2m${item.description}\x1b[0m`);
                        else lines.push(`    ${item.icon}  \x1b[2m${item.label}\x1b[0m`);
                    }
                    lines.push('', `  \x1b[2m↑↓ Navigate  ⏎ Select\x1b[0m`);
                    // if (actLineCount > 0) readline.moveCursor(process.stdout, 0, -actLineCount);
                    for (const line of lines) process.stdout.write('\r\x1b[K' + line + '\n');
                    actLineCount = lines.length;
                };

                console.clear();
                renderActMenu();

                const onKey = async (_str: string, key: any) => {
                    if (!key) return;
                    if (key.name === 'up') { actSelected = (actSelected - 1 + actionItems.length) % actionItems.length; renderActMenu(); }
                    else if (key.name === 'down') { actSelected = (actSelected + 1) % actionItems.length; renderActMenu(); }
                    else if (key.name === 'return') {
                        process.stdin.removeListener('keypress', onKey);
                        console.clear();
                        await actionItems[actSelected].action();
                        setTimeout(() => {
                            parentMenuFn();
                            resolve();
                        }, 1000);
                    }
                };

                process.stdin.on('keypress', onKey);
            });
        }
    }));

    items.push({
        label: 'Back', icon: '↩️', description: 'Return to menu',
        action: async () => { parentMenuFn(); }
    });

    return new Promise<void>((resolve) => {
        let selected = 0;
        let lineCount = 0;

        const render = () => {
            hideCursor();
            console.clear();
            const lines = [`  \x1b[1;36mSelect Process\x1b[0m`, ''];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (i === selected) lines.push(`  \x1b[36m❯ ${item.icon}  ${item.label}\x1b[0m  \x1b[2m${item.description}\x1b[0m`);
                else lines.push(`    ${item.icon}  \x1b[2m${item.label}\x1b[0m`);
            }
            lines.push('', `  \x1b[2m↑↓ Navigate  ⏎ Select\x1b[0m`);
            // if (lineCount > 0) readline.moveCursor(process.stdout, 0, -lineCount);
            for (const line of lines) process.stdout.write('\r\x1b[K' + line + '\n');
            lineCount = lines.length;
        };

        console.clear();
        render();

        const onKey = async (_str: string, key: any) => {
            if (!key) return;
            if (key.name === 'up') { selected = (selected - 1 + items.length) % items.length; render(); }
            else if (key.name === 'down') { selected = (selected + 1) % items.length; render(); }
            else if (key.name === 'return') {
                process.stdin.removeListener('keypress', onKey);
                await items[selected].action();
                resolve();
            }
        };

        process.stdin.on('keypress', onKey);
    });
}

function showInteractiveMenu(): Promise<void> {
    return new Promise((resolve, reject) => {
        const items: MenuItem[] = [
            {
                label: 'Start Server',
                icon: '🚀',
                description: `port ${getPort()}`,
                action: async () => { await cmdStart(false); },
            },
            {
                label: 'Setup Wizard',
                icon: '⚙️',
                description: 'Configure AI platform',
                action: cmdSetup,
            },
            {
                label: 'Manage Processes',
                icon: '🛠️',
                description: 'Restart or kill Roblox',
                action: async () => {
                    if (process.stdin.isTTY) {
                        process.stdin.setRawMode(false);
                        process.stdin.pause();
                        process.stdin.removeAllListeners('keypress');
                    }
                    await manageProcessesMenu(() => showInteractiveMenu());
                },
            },
            {
                label: 'Update',
                icon: '🔄',
                description: 'Check for new version',
                action: cmdUpdate,
            },
        ];

        let selected = 0;
        _menuLineCount = 0;

        console.clear();
        renderMenu(items, selected);

        if (!process.stdin.isTTY) {
            showCursor();
            cmdStart(false).then(resolve);
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

        process.stdin.on('keypress', async (_str: string, key: any) => {
            if (!key) return;
            if (key.ctrl && key.name === 'c') {
                cleanup();
                console.clear();
                process.exit(0);
            }
            if (key.name === 'up') {
                selected = (selected - 1 + items.length) % items.length;
                renderMenu(items, selected);
                return;
            }
            if (key.name === 'down') {
                selected = (selected + 1) % items.length;
                renderMenu(items, selected);
                return;
            }
            if (key.name === 'return') {
                cleanup();
                console.clear();
                console.log(`  \x1b[1m${items[selected].icon}  ${items[selected].label}\x1b[0m\n`);

                try {
                    await items[selected].action();
                } catch (err: any) {
                    console.error(`  \x1b[31m✖ ${err.message}\x1b[0m`);
                }

                if (items[selected].label !== 'Start Server') {
                    console.log(`\n  \x1b[2mPress any key...\x1b[0m`);
                    readline.emitKeypressEvents(process.stdin);
                    process.stdin.setRawMode(true);
                    process.stdin.resume();
                    process.stdin.once('keypress', () => {
                        process.stdin.setRawMode(false);
                        process.stdin.pause();
                        process.stdin.removeAllListeners('keypress');
                        showInteractiveMenu().then(resolve).catch(reject);
                    });
                } else {
                    resolve();
                }
            }
        });
    });
}

// ── Entry ───────────────────────────────────────────

async function main(): Promise<void> {
    console.clear();
    process.title = 'rblx-mcp';
    const args = process.argv.slice(2);

    if (args.length === 0) {
        await showInteractiveMenu();
        return;
    }

    const cmd = args[0];

    if (cmd === 'start') { await cmdStart(false); return; }
    if (cmd === 'daemon') { await cmdStart(true); return; }
    if (cmd === 'stdio') { await cmdStdio(); return; }
    if (cmd === 'setup') { await cmdSetup(); return; }
    if (cmd === 'update') { await cmdUpdate(); return; }
    if (cmd === 'stop') { await cmdStop(); return; }

    console.log(`  \x1b[33m⚠ Unknown: "${cmd}"\x1b[0m`);
    console.log(`  \x1b[2mAvailable: start, stdio, setup, update, stop\x1b[0m\n`);
    await showInteractiveMenu();
}

// Cleanup PID file on exit
process.on('exit', () => { if (!_isHandingOverToDaemon) cleanupPidFile(); });
process.on('SIGTERM', () => { if (!_isHandingOverToDaemon) cleanupPidFile(); process.exit(0); });
process.on('SIGINT', () => { if (!_isHandingOverToDaemon) cleanupPidFile(); process.exit(0); });

main().catch((err: any) => {
    showCursor();
    console.error('[rblx-mcp] Fatal:', err.message);
    process.exit(1);
});

export {};
