

import type { Request, Response, Application, RequestHandler, NextFunction } from 'express';
import type { Server } from 'http';

const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const PKG = require('../package.json');
const { QueueManager: QueueManagerCls } = require('./queue-manager');
const { McpHandler: McpHandlerCls } = require('./mcp-handler');
const { ToolDefinitions: ToolDefinitionsCls } = require('./tool-definitions');
const { SessionManager: SessionManagerCls } = require('./session-manager');
const { WsServer: WsServerCls } = require('./ws-server');
const processManager = require('./process-manager');

type QueueManager = InstanceType<typeof QueueManagerCls>;
type ToolDefinitions = InstanceType<typeof ToolDefinitionsCls>;
type McpHandler = InstanceType<typeof McpHandlerCls>;
type SessionManager = InstanceType<typeof SessionManagerCls>;
type WsServer = InstanceType<typeof WsServerCls>;

const PKG_DIR: string = path.resolve(__dirname, '..');

interface CreateAppOptions {
    verbose?: boolean;
}

interface McpMessage {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: any;
}

interface AppComponents {
    app: Application;
    server: Server;
    queue: QueueManager;
    tools: ToolDefinitions;
    mcp: McpHandler;
    sessions: SessionManager;
    processManager: typeof processManager;
    wss: WsServer;
}

function handleMcpMessage(mcp: McpHandler): RequestHandler {
    return async (req: Request, res: Response): Promise<void> => {
        const message: McpMessage = req.body;
        try {
            if (!message || typeof message !== 'object' || !message.method) {
                res.status(400).json({
                    jsonrpc: '2.0',
                    id: (message && message.id) ?? null,
                    error: { code: -32600, message: 'Invalid Request: method required' },
                });
                return;
            }
            const result = await mcp.handleMessage(message);
            res.json({ jsonrpc: '2.0', id: message.id, result: result.result, error: result.error });
        } catch (err: any) {
            const errorMsg = err instanceof Error ? err.message : String(err ?? 'Unknown error');
            res.json({ jsonrpc: '2.0', id: (message && message.id) ?? null, error: { code: -32603, message: errorMsg } });
        }
    };
}

function createApp(opts?: CreateAppOptions): AppComponents {
    const IS_VERBOSE: boolean = !!(opts && opts.verbose);
    let transportMode: 'auto' | 'ws' | 'stream' = (process.env.MCP_TRANSPORT as any) || 'auto';
    const transportControl = {
        getMode: () => transportMode,
        setMode: (m: 'auto' | 'ws' | 'stream') => { transportMode = m; }
    };

    const queue = new QueueManagerCls();
    const tools = new ToolDefinitionsCls();
    const sessions = new SessionManagerCls();
    const mcp = new McpHandlerCls(queue, tools, sessions, processManager, transportControl);

    const log = IS_VERBOSE
        ? (...args: any[]) => console.log('[MCP]', ...args)
        : () => {};

    const app: Application = express();
    app.use(express.json({ limit: '10mb' }));
    const publicDir: string = path.join(PKG_DIR, 'public');

    app.use((_req: Request, res: Response, next: NextFunction): void => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
        next();
    });

    const mcpLuaPath: string = path.join(PKG_DIR, 'public', 'mcp.lua');

    const serveMcpLua: RequestHandler = (_req: Request, res: Response): void => {
        try {
            if (fs.existsSync(mcpLuaPath)) {
                const content = fs.readFileSync(mcpLuaPath, 'utf-8');
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.send(content);
                return;
            }
        } catch {}
        res.status(404).send('-- mcp.lua not found.');
    };

    app.get('/mcp.lua', serveMcpLua);
    app.get('/mcp.luau', serveMcpLua);
    if (fs.existsSync(publicDir)) app.use(express.static(publicDir));

    const server: Server = http.createServer(app);
    const wss = new WsServerCls(queue, sessions);
    wss.mount(server);

    const mcpHandler: RequestHandler = handleMcpMessage(mcp);

    app.get('/', (_req: Request, res: Response): void => {
        const port = parseInt(process.env.MCP_PORT!, 10) || 28429;
        const dashboardPath: string = path.join(PKG_DIR, 'public', 'dashboard.html');
        if (fs.existsSync(dashboardPath)) {
            let html: string = fs.readFileSync(dashboardPath, 'utf-8');
            html = html.replace(/\{\{\s*port\s*\}\}/g, String(port)).replace(/\{\{\s*version\s*\}\}/g, PKG.version);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } else {
            res.send(`<h1>Roblox MCP Server v${PKG.version}</h1><p>Port: ${port}</p>`);
        }
    });

    app.post('/', mcpHandler);
    app.post('/mcp', mcpHandler);

    app.get('/type', (_req: Request, res: Response): void => {
        const port = parseInt(process.env.MCP_PORT!, 10) || 28429;
        const host = _req.hostname || 'localhost';
        res.json({
            server: 'roblox-difz',
            version: PKG.version,
            tools: tools.count,
            transport: `http+${transportMode}`,
            http: `http://${host}:${port}/mcp`,
            ws: `ws://${host}:${port}/ws`,
            stream: `http://${host}:${port}/stream`,
            info: `http://${host}:${port}/type`,
        });
    });

    app.get('/api/transport', (_req: Request, res: Response): void => {
        const port = parseInt(process.env.MCP_PORT!, 10) || 28429;
        const host = _req.hostname || 'localhost';
        const counts = sessions.countByTransport ? sessions.countByTransport() : { ws: 0, stream: 0 };
        const activeTransport = counts.stream > 0 ? 'stream' : (counts.ws > 0 ? 'ws' : (transportMode === 'auto' ? 'ws' : transportMode));
        res.json({
            mode: transportMode,
            active_transport: activeTransport,
            ws_url: `ws://${host}:${port}/ws`,
            stream_urls: {
                register: `http://${host}:${port}/stream/register`,
                poll: `http://${host}:${port}/stream/poll`,
                result: `http://${host}:${port}/stream/result`,
                ping: `http://${host}:${port}/stream/ping`,
            },
            ws_clients: wss.connectedCount,
            stream_workers: counts.stream,
            active_sessions: sessions.activeCount,
        });
    });

    app.post('/api/transport', (req: Request, res: Response): void => {
        const { mode } = req.body || {};
        if (mode && ['auto', 'ws', 'stream'].includes(mode)) {
            transportMode = mode;
            res.json({ success: true, mode: transportMode });
        } else {
            res.status(400).json({ success: false, error: "mode must be 'auto', 'ws', or 'stream'" });
        }
    });

    app.post('/stream/register', (req: Request, res: Response): void => {
        const { worker_id, username, pid, placeId, jobId, placeName, capabilities } = req.body || {};
        if (!worker_id) {
            res.status(400).json({ success: false, error: 'worker_id is required' });
            return;
        }
        sessions.register(worker_id, {
            pid,
            name: username || 'RobloxStreamWorker',
            transport: 'stream',
            capabilities,
        });
        console.log(`[Stream] Registered: ${worker_id}${pid ? ' pid=' + pid : ''} "${placeName || ''}"`);
        res.json({
            success: true,
            worker_id,
            mode: transportMode,
            registered_at: Date.now(),
        });
    });

    const handleStreamPoll: RequestHandler = async (req: Request, res: Response): Promise<void> => {
        const workerId = (req.query.worker_id as string) || (req.body && req.body.worker_id) || undefined;
        const timeoutMs = parseInt((req.query.timeout as string) || (req.body && req.body.timeout), 10) || 20000;

        if (workerId && sessions.touch) {
            sessions.touch(workerId);
        }

        try {
            const task = await queue.waitForTask(Math.min(timeoutMs, 30000), workerId);
            if (task) {
                res.json({ success: true, task });
            } else {
                res.json({ success: true, task: null, status: 'timeout' });
            }
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    };
    app.get('/stream/poll', handleStreamPoll);
    app.post('/stream/poll', handleStreamPoll);

    app.post('/stream/result', (req: Request, res: Response): void => {
        const { id, data, error, worker_id } = req.body || {};
        if (!id) {
            res.status(400).json({ success: false, error: 'task id is required' });
            return;
        }
        if (worker_id && sessions.touch) {
            sessions.touch(worker_id);
        }
        const resolved = queue.resolveTask(id, data, error);
        res.json({ success: resolved });
    });

    app.post('/stream/ping', (req: Request, res: Response): void => {
        const { worker_id } = req.body || {};
        if (worker_id && sessions.touch) {
            sessions.touch(worker_id);
        }
        res.json({ success: true, timestamp: Date.now() });
    });

    app.get('/api/processes', (_req: Request, res: Response): void => {
        const procs = processManager.listRobloxProcesses();
        res.json({ processes: procs });
    });

    app.post('/api/processes/:pid/kill', (_req: Request, res: Response): void => {
        const pid = parseInt(_req.params.pid as string, 10);
        const success = processManager.killProcess(pid);
        res.json({ success });
    });

    app.post('/api/processes/:pid/restart', (_req: Request, res: Response): void => {
        const pid = parseInt(_req.params.pid as string, 10);
        processManager.killProcess(pid);
        setTimeout(() => {
            const result = processManager.launchRoblox();
            res.json({ success: result.success });
        }, 1000);
    });

    app.get('/health', (_req: Request, res: Response): void => {
        res.json({
            status: 'ok',
            uptime: process.uptime(),
            port: parseInt(process.env.MCP_PORT!, 10) || 28429,
            ...queue.getStats(),
            toolsRegistered: tools.count,
            wsConnections: wss.connectedCount,
            activeSessions: sessions.activeCount,
            robloxProcesses: processManager.listRobloxProcesses().length,
        });
    });

    if (IS_VERBOSE) {
        log('Server initialized with', tools.count, 'tools');
    }

    // SPA catch-all: serve dashboard for any unmatched GET route (e.g. /service_discoverer)
    app.get('*', (_req: Request, res: Response): void => {
        const port = parseInt(process.env.MCP_PORT!, 10) || 28429;
        const dashboardPath: string = path.join(PKG_DIR, 'public', 'dashboard.html');
        if (fs.existsSync(dashboardPath)) {
            let html: string = fs.readFileSync(dashboardPath, 'utf-8');
            html = html.replace(/\{\{\s*port\s*\}\}/g, String(port)).replace(/\{\{\s*version\s*\}\}/g, PKG.version);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } else {
            res.status(404).send('Not found');
        }
    });

    return { app, server, queue, tools, mcp, sessions, processManager, wss };
}

module.exports = { createApp };
