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
    onStopRequest?: () => Promise<void> | void;
}

export class DiscoveryServer {
    private server: http.Server | null = null;
    private activePort: number;
    private discoveryPort: number;
    private onStopRequest?: () => Promise<void> | void;

    constructor(opts: DiscoveryServerOptions) {
        this.activePort = opts.activePort;
        this.discoveryPort = opts.discoveryPort || getDiscoveryPort();
        this.onStopRequest = opts.onStopRequest;
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

            // 1. Port discovery endpoint
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

            // 2. Remote stop endpoint
            if (parsedUrl === '/stop' || parsedUrl === '/api/stop') {
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: true,
                    message: `Host server on port ${this.activePort} is shutting down...`,
                    pid: process.pid,
                }));

                setTimeout(async () => {
                    console.log(`\n  \x1b[33m⚡ Stop signal received via discovery port (${this.discoveryPort}). Shutting down (PID ${process.pid})...\x1b[0m`);
                    if (this.onStopRequest) {
                        try { await this.onStopRequest(); } catch {}
                    }
                    this.stop();
                    process.exit(0);
                }, 300);
                return;
            }

            // 3. Serve mcp.lua with dynamically injected active port
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

            // Fallback status response
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                name: 'roblox-mcp-discovery-router',
                status: 'online',
                active_port: this.activePort,
                discovery_port: this.discoveryPort,
                pid: process.pid,
            }));
        });

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
        if (this.server) {
            try { this.server.close(); } catch {}
            this.server = null;
        }
    }
}
