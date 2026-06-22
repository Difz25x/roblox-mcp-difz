/**
 * server-core.ts
 *
 * Roblox MCP Server — core module.
 *
 * Standard MCP HTTP endpoints:
 *   POST /              MCP JSON-RPC 2.0 (primary — spec compliant)
 *   POST /mcp           MCP JSON-RPC 2.0 (alias)
 *   GET  /health        Health check
 *
 * Bridge endpoints (executor long-poll):
 *   POST /req           Executor fetches next task
 *   POST /res           Executor returns result
 *
 * WebSocket:
 *   ws://host:port/ws   Default executor transport (register/task/result)
 *
 * Static:
 *   GET /mcp.luau       Luau client script
 */
import type { Request, Response, Application, RequestHandler, NextFunction } from 'express';
import type { Server } from 'http';

const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
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

const PKG_DIR: string = path.resolve(__dirname, '..');

function handleMcpMessage(mcp: McpHandler, log: (...args: any[]) => void): RequestHandler {
    return async (req: Request, res: Response): Promise<void> => {
        const message: McpMessage = req.body;
        if (!message || typeof message !== 'object' || !message.method) {
            res.status(400).json({
                jsonrpc: '2.0',
                id: (message && message.id) || null,
                error: { code: -32600, message: 'Invalid Request: method required' },
            });
            return;
        }
        try {
            const result = await mcp.handleMessage(message);
            res.json({ jsonrpc: '2.0', id: message.id, ...result });
        } catch (err: any) {
            res.json({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: err.message } });
        }
    };
}

function createApp(opts?: CreateAppOptions): AppComponents {
    const IS_VERBOSE: boolean = !!(opts && opts.verbose);

    const queue = new QueueManagerCls();
    const tools = new ToolDefinitionsCls();
    const sessions = new SessionManagerCls();
    const mcp = new McpHandlerCls(queue, tools, sessions, processManager);

    const log: (...args: any[]) => void = IS_VERBOSE
        ? (...args: any[]) => console.log('[MCP]', ...args)
        : () => {};

    const app: Application = express();
    app.use(express.json({ limit: '10mb' }));

    // Only serve static files if public/ directory exists
    const publicDir: string = path.join(PKG_DIR, 'public');
    if (fs.existsSync(publicDir)) {
        app.use(express.static(publicDir));
    }

    // CORS
    app.use((req: Request, res: Response, next: NextFunction): void => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') {
            res.sendStatus(204);
            return;
        }
        next();
    });

    // Create HTTP server + mount WebSocket
    const server: Server = http.createServer(app);
    const wss = new WsServerCls(queue, sessions);
    wss.mount(server);

    const mcpHandler: RequestHandler = handleMcpMessage(mcp, log);

    // MCP endpoints
    app.post('/', mcpHandler);
    app.post('/mcp', mcpHandler);

    // Bridge: executor long-poll (fallback, WebSocket preferred)
    app.post('/req', async (req: Request, res: Response): Promise<void> => {
        const timeout: number = Math.min((req.body && req.body.timeout) || 25000, 60000);
        const workerId: string | undefined = req.body && req.body.worker_id;
        if (workerId) {
            sessions.register(workerId, { pid: req.body.pid, name: 'RobloxPlayerBeta' });
        }
        try {
            const task = await queue.waitForTask(timeout, workerId);
            if (task) {
                res.json({ type: task.type, id: task.id, args: task.args, timestamp: task.timestamp });
            } else {
                res.json({ type: '__timeout__', id: null, args: null });
            }
        } catch (err: any) {
            res.status(500).json({ type: '__error__', id: null, error: err.message });
        }
    });

    // Bridge: executor result
    app.post('/res', (req: Request, res: Response): void => {
        const { id, data, error } = req.body || {};
        if (!id) {
            res.status(400).json({ success: false, error: 'Missing task id' });
            return;
        }
        const ok: boolean = queue.resolveTask(id, data, error);
        res.json(ok ? { success: true } : { success: false, reason: 'Unknown or expired task ID' });
    });

    // Server info endpoint
    app.get('/type', (req: Request, res: Response): void => {
        const port = parseInt(process.env.MCP_PORT as string, 10) || 28429;
        const host = req.hostname || 'localhost';
        res.json({
            server: 'roblox-mcp-difz',
            version: '1.3.2',
            description: 'Universal MCP server for Roblox game control and reverse engineering',
            transports: {
                http: { url: `http://${host}:${port}/mcp`, methods: ['POST'] },
                websocket: { url: `ws://${host}:${port}/ws` },
            },
            tools: tools.count,
            health: '/health',
            metadata: '/type',
        });
    });

    // Health
    app.get('/health', (req: Request, res: Response): void => {
        res.json({
            status: 'ok',
            uptime: process.uptime(),
            port: parseInt(process.env.MCP_PORT as string, 10) || 28429,
            ...queue.getStats(),
            toolsRegistered: tools.count,
            wsConnections: wss ? wss.connectedCount : 0,
            activeSessions: sessions.activeCount,
            robloxProcesses: processManager.listRobloxProcesses().length,
        });
    });

    return { app, server, queue, tools, mcp, sessions, processManager, wss };
}

function createMcpServerDeps() {
    const queue = new QueueManagerCls();
    const tools = new ToolDefinitionsCls();
    const sessions = new SessionManagerCls();
    return { queue, tools, sessions, proc: processManager };
}

module.exports = { createApp, createMcpServerDeps };
