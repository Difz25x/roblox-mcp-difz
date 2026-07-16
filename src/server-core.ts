

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
    const queue = new QueueManagerCls();
    const tools = new ToolDefinitionsCls();
    const sessions = new SessionManagerCls();
    const mcp = new McpHandlerCls(queue, tools, sessions, processManager);

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

    let mcpLuaCache: string | null = null;
    const mcpLuaPath: string = path.join(PKG_DIR, 'public', 'mcp.lua');

    app.get('/mcp.lua', (_req: Request, res: Response): void => {
        if (!mcpLuaCache) {
            if (fs.existsSync(mcpLuaPath)) {
                mcpLuaCache = fs.readFileSync(mcpLuaPath, 'utf-8');
            }
        }
        if (mcpLuaCache) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.send(mcpLuaCache);
        } else res.status(404).send('-- mcp.lua not found.');
    });
    app.get('/mcp.luau', (_req: Request, res: Response): void => {
        if (!mcpLuaCache) {
            if (fs.existsSync(mcpLuaPath)) {
                mcpLuaCache = fs.readFileSync(mcpLuaPath, 'utf-8');
            }
        }
        if (mcpLuaCache) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.send(mcpLuaCache);
        } else res.status(404).send('-- mcp.lua not found.');
    });
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
            server: 'roblox-mcp-difz',
            version: PKG.version,
            tools: tools.count,
            transport: 'http+ws',
            http: `http://${host}:${port}/mcp`,
            ws: `ws://${host}:${port}/ws`,
            info: `http://${host}:${port}/type`,
        });
    });

    app.get('/api/processes', (_req: Request, res: Response): void => {
        const procs = processManager.listRobloxProcesses();
        res.json({ processes: procs });
    });

    app.post('/api/processes/:pid/kill', (_req: Request, res: Response): void => {
        const pid = parseInt(_req.params.pid, 10);
        const success = processManager.killProcess(pid);
        res.json({ success });
    });

    app.post('/api/processes/:pid/restart', (_req: Request, res: Response): void => {
        const pid = parseInt(_req.params.pid, 10);
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
