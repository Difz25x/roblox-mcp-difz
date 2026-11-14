import { spawn, spawnSync, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

const CONFIG_DIR = path.join(os.homedir(), '.roblox-mcp');
const BIN_DIR = path.join(CONFIG_DIR, 'bin');

let _activeTunnelProcess: ChildProcess | null = null;
let _activeProxyUrl: string | null = null;

export function getActiveProxyUrl(): string | null {
    return _activeProxyUrl;
}

export function isProxyRunning(): boolean {
    return !!(_activeProxyUrl && _activeTunnelProcess && !_activeTunnelProcess.killed);
}

export function findCloudflared(): string | null {
    const isWin = process.platform === 'win32';
    const checkCmd = isWin ? 'where.exe' : 'which';

    // 1. Check in PATH
    try {
        const res = spawnSync(checkCmd, ['cloudflared'], {
            encoding: 'utf-8',
            windowsHide: true,
            timeout: 3000,
        });
        if (res.status === 0 && res.stdout) {
            const firstLine = res.stdout.trim().split(/\r?\n/)[0]?.trim();
            if (firstLine && fs.existsSync(firstLine)) {
                return firstLine;
            }
        }
    } catch {}

    // 2. Check well-known installation paths
    const candidates: string[] = [];
    if (isWin) {
        candidates.push(
            'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
            'C:\\Program Files\\cloudflared\\cloudflared.exe',
            path.join(BIN_DIR, 'cloudflared.exe')
        );
    } else {
        candidates.push(
            '/usr/local/bin/cloudflared',
            '/usr/bin/cloudflared',
            path.join(BIN_DIR, 'cloudflared')
        );
    }

    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        } catch {}
    }

    return null;
}

function downloadFile(fileUrl: string, destPath: string, maxRedirects: number = 5): Promise<void> {
    return new Promise((resolve, reject) => {
        if (maxRedirects <= 0) {
            return reject(new Error('Too many redirects while downloading cloudflared'));
        }

        const parsedUrl = new URL(fileUrl);
        const client = parsedUrl.protocol === 'https:' ? https : http;

        const req = client.get(fileUrl, {
            headers: {
                'User-Agent': 'roblox-mcp-difz',
                'Accept': '*/*',
            },
            timeout: 30000,
        }, (res) => {
            const status = res.statusCode || 0;

            if (status >= 300 && status < 400 && res.headers.location) {
                const nextUrl = new URL(res.headers.location, fileUrl).toString();
                return downloadFile(nextUrl, destPath, maxRedirects - 1)
                    .then(resolve)
                    .catch(reject);
            }

            if (status !== 200) {
                return reject(new Error(`Download failed with HTTP status ${status}`));
            }

            const fileStream = fs.createWriteStream(destPath);
            res.pipe(fileStream);

            fileStream.on('finish', () => {
                fileStream.close(() => resolve());
            });

            fileStream.on('error', (err) => {
                try { fs.unlinkSync(destPath); } catch {}
                reject(err);
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Download connection timed out'));
        });
    });
}

export async function downloadCloudflared(onProgress?: (msg: string) => void): Promise<string> {
    if (!fs.existsSync(BIN_DIR)) {
        fs.mkdirSync(BIN_DIR, { recursive: true });
    }

    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const isArm = process.arch === 'arm64';

    let downloadUrl = '';
    const filename = isWin ? 'cloudflared.exe' : 'cloudflared';
    const targetPath = path.join(BIN_DIR, filename);

    if (isWin) {
        downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
    } else if (isMac) {
        downloadUrl = isArm
            ? 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64'
            : 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64';
    } else {
        downloadUrl = isArm
            ? 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64'
            : 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';
    }

    if (onProgress) onProgress(`Downloading cloudflared from GitHub releases...`);
    await downloadFile(downloadUrl, targetPath);

    if (!isWin) {
        try { fs.chmodSync(targetPath, 0o755); } catch {}
    }

    return targetPath;
}

export async function startProxyTunnel(
    port: number,
    onStatus?: (status: string) => void
): Promise<{ url: string }> {
    if (_activeProxyUrl && _activeTunnelProcess && !_activeTunnelProcess.killed) {
        return { url: _activeProxyUrl };
    }

    let binPath = findCloudflared();
    if (!binPath) {
        if (onStatus) onStatus('cloudflared not detected. Downloading binary...');
        binPath = await downloadCloudflared(onStatus);
    }

    if (onStatus) onStatus(`Starting Cloudflare tunnel for port ${port}...`);

    stopProxyTunnel();

    return new Promise<{ url: string }>((resolve, reject) => {
        let isResolved = false;

        const child = spawn(binPath!, ['tunnel', '--url', `http://127.0.0.1:${port}`], {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        _activeTunnelProcess = child;

        const timeout = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                stopProxyTunnel();
                reject(new Error('Cloudflare tunnel timed out while waiting for public URL (30s).'));
            }
        }, 30000);

        const urlRegex = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

        const handleData = (chunk: Buffer) => {
            const text = chunk.toString();
            const match = text.match(urlRegex);
            if (match && !isResolved) {
                isResolved = true;
                clearTimeout(timeout);
                _activeProxyUrl = match[0];
                resolve({ url: _activeProxyUrl });
            }
        };

        if (child.stdout) child.stdout.on('data', handleData);
        if (child.stderr) child.stderr.on('data', handleData);

        child.on('error', (err) => {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(timeout);
                _activeTunnelProcess = null;
                _activeProxyUrl = null;
                reject(err);
            }
        });

        child.on('exit', (code) => {
            _activeTunnelProcess = null;
            _activeProxyUrl = null;
            if (!isResolved) {
                isResolved = true;
                clearTimeout(timeout);
                reject(new Error(`cloudflared exited unexpectedly with code ${code}`));
            }
        });
    });
}

export function stopProxyTunnel(): void {
    if (_activeTunnelProcess) {
        try {
            if (process.platform === 'win32' && _activeTunnelProcess.pid) {
                spawnSync('taskkill', ['/F', '/T', '/PID', String(_activeTunnelProcess.pid)], {
                    windowsHide: true,
                    stdio: 'ignore',
                });
            } else {
                _activeTunnelProcess.kill('SIGTERM');
            }
        } catch {}
        _activeTunnelProcess = null;
    }
    _activeProxyUrl = null;
}
