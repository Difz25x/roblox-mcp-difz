import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

export const DEFAULT_DISCOVERY_PORT = 58295;

export function getDiscoveryPort(): number {
    const envVal = parseInt(process.env.MCP_DISCOVERY_PORT!, 10);
    if (!isNaN(envVal) && envVal > 0 && envVal <= 65535) {
        return envVal;
    }
    return DEFAULT_DISCOVERY_PORT;
}

export interface DiscoveryServerOptions {
    activePort: number;
    discoveryPort?: number;
}

// Global registry of all active discovery server instances for graceful process exit
const activeDiscoveryInstances: Set<DiscoveryServer> = new Set();

export function stopAllDiscoveryServers(): void {
    for (const inst of activeDiscoveryInstances) {
        try {
            inst.stop();
        } catch {}
    }
    activeDiscoveryInstances.clear();
}

// Auto-cleanup on process termination
process.on('exit', () => {
    stopAllDiscoveryServers();
});
process.on('SIGTERM', () => {
    stopAllDiscoveryServers();
});
process.on('SIGINT', () => {
    stopAllDiscoveryServers();
});

export class DiscoveryServer {
    private server: http.Server | null = null;
    private activePort: number;
    private discoveryPort: number;
    private sockets: Set<any> = new Set();

    constructor(opts: DiscoveryServerOptions) {
        this.activePort = opts.activePort;
        this.discoveryPort = opts.discoveryPort || getDiscoveryPort();
    }

    public updateActivePort(port: number): void {
        this.activePort = port;
    }

    public getActivePort(): number {
        return this.activePort;
    }

    public getDiscoveryPort(): number {
        return this.discoveryPort;
    }

    public async start(): Promise<void> {
        if (this.discoveryPort === this.activePort) {
            return;
        }

        const mcpLuaPath = path.resolve(__dirname, '..', 'public', 'mcp.lua');

        this.server = http.createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }

            const parsedUrl = req.url ? req.url.split('?')[0] : '/';

            // 1. Port discovery endpoint (mcp.lua and clients use this to discover active port)
            if (parsedUrl === '/port' || parsedUrl === '/discovery' || parsedUrl === '/api/port') {
                const payload = JSON.stringify({
                    success: true,
                    port: this.activePort,
                    discovery_port: this.discoveryPort,
                    pid: process.pid,
                    ws: `ws://127.0.0.1:${this.activePort}/ws`,
                    http: `http://127.0.0.1:${this.activePort}`,
                    timestamp: Date.now(),
                });
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(payload);
                return;
            }

            // 2. Serve mcp.lua with dynamically injected active port
            if (parsedUrl === '/mcp.lua' || parsedUrl === '/mcp.luau') {
                try {
                    if (fs.existsSync(mcpLuaPath)) {
                        let content = fs.readFileSync(mcpLuaPath, 'utf-8');
                        content = content.replace(
                            /local PORT = G_GET\("MCP_PORT"\) or \d+/,
                            `local PORT = G_GET("MCP_PORT") or ${this.activePort}`
                        );
                        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
                        res.end(content);
                        return;
                    }
                } catch {}
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('-- mcp.lua not found.');
                return;
            }

            // Fallback status response (Notice: NO /stop endpoint here — lifecycle tied strictly to roblox-mcp)
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                name: 'roblox-mcp-discovery-router',
                status: 'online',
                active_port: this.activePort,
                discovery_port: this.discoveryPort,
                pid: process.pid,
            }));
        });

        // Track all incoming sockets to destroy them immediately upon server stop
        this.server.on('connection', (socket) => {
            this.sockets.add(socket);
            socket.on('close', () => {
                this.sockets.delete(socket);
            });
        });

        activeDiscoveryInstances.add(this);

        return new Promise((resolve) => {
            this.server?.once('error', (err: any) => {
                console.error(`  \x1b[33m[Discovery] Notice: Could not bind discovery router to port ${this.discoveryPort}: ${err.message}\x1b[0m`);
                resolve();
            });

            this.server?.listen(this.discoveryPort, () => {
                resolve();
            });
        });
    }

    public stop(): void {
        activeDiscoveryInstances.delete(this);

        // Instantly destroy all open client keep-alive sockets
        for (const socket of this.sockets) {
            try {
                socket.destroy();
            } catch {}
        }
        this.sockets.clear();

        if (this.server) {
            try {
                if (typeof (this.server as any).closeAllConnections === 'function') {
                    (this.server as any).closeAllConnections();
                }
            } catch {}
            try {
                this.server.close();
            } catch {}
            this.server = null;
        }
    }
}

