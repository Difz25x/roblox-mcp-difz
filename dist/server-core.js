"use strict";
/**
 * server-core.ts
 *
 * Roblox MCP Server — core module.
 *
 * Standard MCP HTTP endpoints:
 *   POST /              MCP JSON-RPC 2.0
 *   POST /mcp           MCP JSON-RPC 2.0 (alias)
 *   GET  /health        Health check
 *
 * WebSocket:
 *   ws://host:port/ws   Executor transport (register/task/result) — WS ONLY
 *
 * Static:
 *   GET /mcp.lua        Executor client script
 */
Object.defineProperty(exports, "__esModule", { value: true });
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
const PKG_DIR = path.resolve(__dirname, '..');
function handleMcpMessage(mcp) {
    return async (req, res) => {
        try {
            const message = req.body;
            if (!message || typeof message !== 'object' || !message.method) {
                res.status(400).json({
                    jsonrpc: '2.0',
                    id: (message && message.id) || null,
                    error: { code: -32600, message: 'Invalid Request: method required' },
                });
                return;
            }
            const result = await mcp.handleMessage(message);
            res.json({ jsonrpc: '2.0', id: message.id, ...result });
        }
        catch (err) {
            res.json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: err.message } });
        }
    };
}
function createApp(opts) {
    const IS_VERBOSE = !!(opts && opts.verbose);
    const queue = new QueueManagerCls();
    const tools = new ToolDefinitionsCls();
    const sessions = new SessionManagerCls();
    const mcp = new McpHandlerCls(queue, tools, sessions, processManager);
    const log = IS_VERBOSE
        ? (...args) => console.log('[MCP]', ...args)
        : () => { };
    const app = express();
    app.use(express.json({ limit: '10mb' }));
    const publicDir = path.join(PKG_DIR, 'public');
    // Serve executor client script
    app.get('/mcp.lua', (_req, res) => {
        const f = path.join(PKG_DIR, 'public', 'mcp.lua');
        if (fs.existsSync(f)) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.send(fs.readFileSync(f, 'utf-8'));
        }
        else
            res.status(404).send('-- mcp.lua not found.');
    });
    app.get('/mcp.luau', (_req, res) => {
        const f = path.join(PKG_DIR, 'public', 'mcp.lua');
        if (fs.existsSync(f)) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.send(fs.readFileSync(f, 'utf-8'));
        }
        else
            res.status(404).send('-- mcp.lua not found.');
    });
    if (fs.existsSync(publicDir))
        app.use(express.static(publicDir));
    // CORS
    app.use((_req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (_req.method === 'OPTIONS') {
            res.sendStatus(204);
            return;
        }
        next();
    });
    // HTTP + WS server
    const server = http.createServer(app);
    const wss = new WsServerCls(queue, sessions);
    wss.mount(server);
    const mcpHandler = handleMcpMessage(mcp);
    // Dashboard at root
    app.get('/', (_req, res) => {
        const port = parseInt(process.env.MCP_PORT, 10) || 28429;
        const dashboardPath = path.join(PKG_DIR, 'public', 'dashboard.html');
        if (fs.existsSync(dashboardPath)) {
            let html = fs.readFileSync(dashboardPath, 'utf-8');
            html = html.replace(/\{\{port\}\}/g, String(port)).replace(/\{\{version\}\}/g, PKG.version);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        }
        else {
            res.send(`<h1>Roblox MCP Server v${PKG.version}</h1><p>Port: ${port}</p>`);
        }
    });
    // MCP JSON-RPC via HTTP (for Claude Code etc.)
    app.post('/', mcpHandler);
    app.post('/mcp', mcpHandler);
    // Server info
    app.get('/type', (_req, res) => {
        const port = parseInt(process.env.MCP_PORT, 10) || 28429;
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
    // Health
    app.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            uptime: process.uptime(),
            port: parseInt(process.env.MCP_PORT, 10) || 28429,
            ...queue.getStats(),
            toolsRegistered: tools.count,
            wsConnections: wss.connectedCount,
            activeSessions: sessions.activeCount,
            robloxProcesses: processManager.listRobloxProcesses().length,
        });
    });
    return { app, server, queue, tools, mcp, sessions, processManager, wss };
}
module.exports = { createApp };
