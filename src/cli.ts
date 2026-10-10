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

function hideCursor(): void { process.stdout.write('\x1b[?25l'); }
function showCursor(): void { process.stdout.write('\x1b[?25h'); }

function printBanner(port: number, toolsCount: number, wsCount: number, pid: number, discoveryPort?: number): void {
    console.log(`  \x1b[1;36mRoblox MCP\x1b[0m \x1b[2mv${PKG.version}\x1b[0m`);
    console.log(`  HTTP      http://localhost:${port}/mcp`);
    console.log(`  WS        ws://localhost:${port}/ws`);
    if (discoveryPort) {
        console.log(`  Discovery http://localhost:${discoveryPort}/port`);
    }
    console.log(`  Tools: ${toolsCount} | Connections: ${wsCount} | PID: ${pid}`);
    console.log(`  \x1b[2mInject: loadstring(game:HttpGet("http://127.0.0.1:${port}/mcp.lua"))()\x1b[0m`);
    if (discoveryPort && discoveryPort !== port) {
        console.log(`  \x1b[2mAuto-sync: loadstring(game:HttpGet("http://127.0.0.1:${discoveryPort}/mcp.lua"))()\x1b[0m`);
    }
}

interface MenuItem {
    label: string;
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
            lines.push(`  \x1b[36m> ${item.label}\x1b[0m  \x1b[2m${item.description}\x1b[0m`);
        } else {
            lines.push(`    \x1b[2m${item.label}\x1b[0m`);
        }
    }
    lines.push('');
    lines.push(`  \x1b[2m[Up/Down] Navigate  [Enter] Select  [Ctrl+C] Exit\x1b[0m`);

    for (const line of lines) {
        process.stdout.write('\r\x1b[K' + line + '\n');
    }
    _menuLineCount = lines.length;
}

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

async function cmdUpdate(): Promise<void> {
    console.log(`  Checking npm registry for updates...`);
    const latest = await fetchLatestVersion();

    if (!latest) {
        console.log(`  Could not reach npm registry.`);
        return;
    }
    if (latest === PKG.version) {
        console.log(`  You are on the latest version (v${PKG.version}).`);
        return;
    }

    console.log(`  Update available: v${PKG.version} -> v${latest}`);
    const yes = await confirm('Install now?');
    if (!yes) {
        console.log(`  Skipped.`);
        return;
    }

    console.log(`  Updating package...`);
    try {
        const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        const res = spawnSync(npmCmd, ['install', '-g', `${PKG.name}@latest`], {
            stdio: 'inherit',
            timeout: 120000,
            shell: true,
            windowsHide: true,
        });
        if (res.error) {
            throw res.error;
        }
        if (res.status !== 0) {
            throw new Error(`npm exited with code ${res.status}`);
        }
        console.log(`  Updated to v${latest}.`);
        console.log(`  Restarting...`);

        const child = spawn(process.execPath, [__filename], {
            stdio: 'inherit',
            detached: false
        });

        child.on('exit', (code: number | null) => {
            process.exit(code || 0);
        });
        return;
    } catch (err: any) {
        console.error(`  Update failed: ${err.message}`);
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
    if (fs.existsSync(PID_FILE)) {
        try {
            const recordedPid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
            if (!isNaN(recordedPid) && recordedPid > 0 && recordedPid !== process.pid) {
                killProcessByPid(recordedPid);
                try { fs.unlinkSync(PID_FILE); } catch {}
            }
        } catch {}
    }

    let conflictingPid = getPidOnPort(port);
    if (conflictingPid) {
        console.log(`  Port ${port} is occupied by PID ${conflictingPid}.`);
        console.log(`  Closing previous process to release port...`);
        killProcessByPid(conflictingPid);

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

        console.log(`  Port ${port} released.\n`);
    }
}

function startListening(server: any, port: number, onListening: () => Promise<void> | void): Promise<void> {
    return new Promise((resolve, reject) => {
        let isResolved = false;

        const onError = async (err: any) => {
            if (err.code === 'EADDRINUSE') {
                console.log(`  Port ${port} busy. Releasing...`);
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

        try { fs.writeFileSync(PID_FILE, String(pid), 'utf-8'); } catch {}

        if (DISCOVERY_PORT !== PORT) {
            _discoveryServer = new DiscoveryServer({
                activePort: PORT,
                discoveryPort: DISCOVERY_PORT
            });
            await _discoveryServer.start();
        }

        if (isDaemon) {
            await startTray(PORT, pid);
        } else {
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
        process.stderr.write(`  Cannot start MCP stdio transport: ${err.message}\n`);
        process.stderr.write(`  Install dependencies first: npm install\n`);
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
            discoveryPort: DISCOVERY_PORT
        });
        await _discoveryServer.start();
    }

    await startListening(server, PORT, () => {
        process.stderr.write(`  [rblx-mcp] Ready on port ${PORT} (discovery: ${DISCOVERY_PORT})\n`);
    });
}

function showPostStartMenu(port: number, pid: number): void {
    const items: MenuItem[] = [
        {
            label: 'Hide in Tray',
            description: 'Run in background with tray icon',
            action: async () => { await hideInTray(port, pid); },
        },
        {
            label: 'Open Dashboard',
            description: `http://localhost:${port}`,
            action: async () => {
                const url = `http://localhost:${port}`;
                if (process.platform === 'win32') {
                    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
                }
                console.log(`  Opened ${url}`);
            },
        },
        {
            label: 'Manage Processes',
            description: 'Restart or close Roblox',
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
            description: 'Shutdown and exit',
            action: async () => {
                cleanupAll();
                console.log(`  Server stopped.`);
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
            cleanupAll();
            console.log('\n  Exiting.');
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
            catch (err: any) { console.error(`  Error: ${err.message}`); }
            if (items[selected].label === 'Open Dashboard') {
                showPostStartMenu(port, pid);
            } else if (items[selected].label !== 'Hide in Tray' && items[selected].label !== 'Stop Server') {
                console.log(`\n  Press any key to continue...`);
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

let _isHandingOverToDaemon = false;

async function hideInTray(port: number, _oldPid: number): Promise<void> {
    console.clear();
    console.log(`  Starting background daemon...`);

    try {
        _isHandingOverToDaemon = true;

        if (_discoveryServer) {
            try { _discoveryServer.stop(); } catch {}
            _discoveryServer = null;
        }

        if (_activeServer) {
            await new Promise<void>(resolve => {
                if (typeof _activeServer.closeAllConnections === 'function') {
                    _activeServer.closeAllConnections();
                }

                const timeout = setTimeout(() => {
                    resolve();
                }, 500);

                _activeServer.close(() => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
        }

        const scriptPath = __filename;
        const logPath = path.join(CONFIG_DIR, 'daemon.log');
        const out = fs.openSync(logPath, 'a');

        const child = spawn(process.execPath, [scriptPath, 'daemon'], {
            detached: true,
            stdio: ['ignore', out, out],
            windowsHide: true
        });

        child.unref();

        console.log(`  Server running in background (PID ${child.pid}).`);
        console.log(`  Use system tray icon to control.\n`);

        process.exit(0);
    } catch (err: any) {
        console.error(`  Failed to start daemon: ${err.message}`);
    }
}

async function startTray(port: number, _pid: number): Promise<void> {
    let SysTray: any;
    try {
        SysTray = require('systray2').default || require('systray2');
    } catch {
        return;
    }

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
            tooltip: `Roblox MCP v${PKG.version} - port ${port}`,
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
            cleanupAll();
            const discPort = getDiscoveryPort();
            const discPid = getPidOnPort(discPort);
            if (discPid && discPid !== process.pid) {
                killProcessByPid(discPid);
            }
            try { systray.kill(false); } catch {}
            process.exit(0);
        }
    });

    try {
        await systray.ready();
    } catch (err: any) {}
}

async function cmdStop(): Promise<void> {
    const PORT = getPort();
    let stoppedAny = false;

    if (fs.existsSync(PID_FILE)) {
        const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
        if (!isNaN(pid)) {
            if (killProcessByPid(pid)) {
                console.log(`  Stopped server (PID ${pid}).`);
                stoppedAny = true;
            }
        }
        cleanupPidFile();
    }

    const portPid = getPidOnPort(PORT);
    if (portPid) {
        if (killProcessByPid(portPid)) {
            console.log(`  Stopped server on port ${PORT} (PID ${portPid}).`);
            stoppedAny = true;
        }
    }

    const DISCOVERY_PORT = getDiscoveryPort();
    if (DISCOVERY_PORT !== PORT) {
        const discPid = getPidOnPort(DISCOVERY_PORT);
        if (discPid && discPid !== portPid) {
            if (killProcessByPid(discPid)) {
                console.log(`  Stopped discovery router on port ${DISCOVERY_PORT} (PID ${discPid}).`);
                stoppedAny = true;
            }
        }
    }

    if (!stoppedAny) {
        console.log(`  No server found running on port ${PORT}.`);
    }
}

function cleanupPidFile(): void {
    try { fs.unlinkSync(PID_FILE); } catch {}
}

async function cmdSetup(): Promise<void> {
    const { runSetupWizard } = require('./setup');
    await runSetupWizard(null);
}

async function cmdSkill(specificTarget?: string): Promise<void> {
    const { runSkillInstallerWizard } = require('./skill-installer');
    await runSkillInstallerWizard(specificTarget || null);
}

async function cmdSdkDoctor(): Promise<void> {
    const { scanMcpSdk, formatSdkReport } = require('./sdk-scanner');
    console.log('\n  Scanning @modelcontextprotocol/sdk environment...\n');
    const diag = scanMcpSdk(true);
    console.log(formatSdkReport(diag));
    console.log('');
}

async function manageProcessesMenu(parentMenuFn: () => void): Promise<void> {
    const { listRobloxProcesses, killProcess, launchRoblox } = require('./process-manager');
    const procs = listRobloxProcesses();

    if (procs.length === 0) {
        console.clear();
        console.log(`  No Roblox processes found.\n`);
        console.log(`  Press any key to return...`);

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
        description: `PID: ${p.pid} | RAM: ${p.memoryMB} MB`,
        action: async () => {
            const actionItems: MenuItem[] = [
                {
                    label: 'Restart', description: 'Close and start fresh process',
                    action: async () => {
                        killProcess(p.pid);
                        await new Promise<void>(r => setTimeout(r, 1000));
                        launchRoblox();
                        console.log('  Process restarted.');
                    }
                },
                {
                    label: 'Close', description: 'Close this process',
                    action: async () => {
                        killProcess(p.pid);
                        console.log('  Process closed.');
                    }
                },
                {
                    label: 'Cancel', description: 'Return to previous screen',
                    action: async () => {}
                }
            ];

            return new Promise<void>((resolve) => {
                let actSelected = 0;

                const renderActMenu = () => {
                    hideCursor();
                    console.clear();
                    const lines = [`  Manage Process: PID ${p.pid}`, ''];
                    for (let i = 0; i < actionItems.length; i++) {
                        const item = actionItems[i];
                        if (i === actSelected) lines.push(`  \x1b[36m> ${item.label}\x1b[0m  \x1b[2m${item.description}\x1b[0m`);
                        else lines.push(`    \x1b[2m${item.label}\x1b[0m`);
                    }
                    lines.push('', `  [Up/Down] Navigate  [Enter] Select`);
                    for (const line of lines) process.stdout.write('\r\x1b[K' + line + '\n');
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
        label: 'Back', description: 'Return to menu',
        action: async () => { parentMenuFn(); }
    });

    return new Promise<void>((resolve) => {
        let selected = 0;

        const render = () => {
            hideCursor();
            console.clear();
            const lines = [`  Select Process`, ''];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (i === selected) lines.push(`  \x1b[36m> ${item.label}\x1b[0m  \x1b[2m${item.description}\x1b[0m`);
                else lines.push(`    \x1b[2m${item.label}\x1b[0m`);
            }
            lines.push('', `  [Up/Down] Navigate  [Enter] Select`);
            for (const line of lines) process.stdout.write('\r\x1b[K' + line + '\n');
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
                description: `port ${getPort()}`,
                action: async () => { await cmdStart(false); },
            },
            {
                label: 'Setup Wizard',
                description: 'Connect AI editor to this server',
                action: cmdSetup,
            },
            {
                label: 'Install AI Skill',
                description: 'Teach AI assistant roblox-mcp tools',
                action: async () => { await cmdSkill(); },
            },
            {
                label: 'Check MCP SDK',
                description: 'Verify SDK installation health',
                action: cmdSdkDoctor,
            },
            {
                label: 'Manage Processes',
                description: 'View, restart, or close Roblox windows',
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
                label: 'Check Updates',
                description: 'Check npm registry for updates',
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
                console.log(`  \x1b[1m${items[selected].label}\x1b[0m\n`);

                try {
                    await items[selected].action();
                } catch (err: any) {
                    console.error(`  Error: ${err.message}`);
                }

                if (items[selected].label !== 'Start Server') {
                    console.log(`\n  Press any key to continue...`);
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
    if (cmd === 'skill' || cmd === 'add-skill' || cmd === 'install-skill') { await cmdSkill(args[1]); return; }
    if (cmd === 'update') { await cmdUpdate(); return; }
    if (cmd === 'stop') { await cmdStop(); return; }
    if (cmd === 'sdk' || cmd === 'doctor') { await cmdSdkDoctor(); return; }

    console.log(`  Unknown command: "${cmd}"`);
    console.log(`  Available: start, stdio, setup, skill, sdk, doctor, update, stop\n`);
    await showInteractiveMenu();
}

function cleanupAll(): void {
    if (_isHandingOverToDaemon) return;
    cleanupPidFile();
    if (_discoveryServer) {
        try { _discoveryServer.stop(); } catch {}
        _discoveryServer = null;
    }
    if (_activeServer) {
        try { _activeServer.close(); } catch {}
        _activeServer = null;
    }
}

process.on('exit', () => { cleanupAll(); });
process.on('SIGTERM', () => { cleanupAll(); process.exit(0); });
process.on('SIGINT', () => { cleanupAll(); process.exit(0); });

main().catch((err: any) => {
    showCursor();
    console.error('[rblx-mcp] Fatal:', err.message);
    process.exit(1);
});

export {};
