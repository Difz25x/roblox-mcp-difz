/**
 * server-core.js
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
 * Static:
 *   GET /mcp.luau       Luau client script
 */
const express = require('express');
const path = require('path');
const { QueueManager } = require('./queue-manager');
const { McpHandler } = require('./mcp-handler');
const { ToolDefinitions } = require('./tool-definitions');

const PKG_DIR = path.resolve(__dirname, '..');

function handleMcpMessage(mcp, log) {
    return async (req, res) => {
        const message = req.body;
        if (!message || typeof message !== 'object' || !message.method) {
            return res.status(400).json({
                jsonrpc: '2.0',
                id: (message && message.id) || null,
                error: { code: -32600, message: 'Invalid Request: method required' },
            });
        }
        try {
            const result = await mcp.handleMessage(message);
            res.json({ jsonrpc: '2.0', id: message.id, ...result });
        } catch (err) {
            res.json({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: err.message } });
        }
    };
}

function createApp(opts) {
    const IS_STDIO = opts && opts.stdio;
    const IS_VERBOSE = opts && opts.verbose;

    const queue = new QueueManager();
    const tools = new ToolDefinitions();
    const mcp = new McpHandler(queue, tools);

    const log = IS_VERBOSE
        ? (...args) => console.log('[MCP]', ...args)
        : () => {};

    const app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use(express.static(path.join(PKG_DIR, 'public')));

    // CORS
    app.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') return res.sendStatus(204);
        next();
    });

    const mcpHandler = handleMcpMessage(mcp, log);

    // Standard MCP HTTP endpoint (spec compliant — primary)
    app.post('/', mcpHandler);
    // Alias for backwards compatibility
    app.post('/mcp', mcpHandler);

    // Bridge: executor long-poll
    app.post('/req', async (req, res) => {
        const timeout = Math.min(req.body && req.body.timeout || 25000, 60000);
        try {
            const task = await queue.waitForTask(timeout);
            if (task) {
                res.json({ type: task.type, id: task.id, args: task.args, timestamp: task.timestamp });
            } else {
                res.json({ type: '__timeout__', id: null, args: null });
            }
        } catch (err) {
            res.status(500).json({ type: '__error__', id: null, error: err.message });
        }
    });

    // Bridge: executor result
    app.post('/res', (req, res) => {
        const { id, data, error } = req.body || {};
        if (!id) return res.status(400).json({ success: false, error: 'Missing task id' });
        const ok = queue.resolveTask(id, data, error);
        res.json(ok ? { success: true } : { success: false, reason: 'Unknown or expired task ID' });
    });

    // Health
    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            uptime: process.uptime(),
            mode: IS_STDIO ? 'http+stdio' : 'http',
            port: parseInt(process.env.MCP_PORT, 10) || 28429,
            ...queue.getStats(),
            toolsRegistered: tools.count,
        });
    });

    return { app, queue, tools, mcp };
}

module.exports = { createApp };
