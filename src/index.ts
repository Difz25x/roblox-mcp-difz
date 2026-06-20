/**
 * index.ts — Programmatic entry for roblox-mcp
 *
 * Usage:
 *   const robloxMcp = require('roblox-mcp-difz');
 *   const { app, queue, tools } = robloxMcp.createApp({ verbose: true });
 *   app.listen(28429);
 *
 *   console.log('Tools:', robloxMcp.getTools().length);
 */

const { createApp } = require('./server-core');
const { ToolDefinitions } = require('./tool-definitions');
const { QueueManager } = require('./queue-manager');
const { SessionManager } = require('./session-manager');
const { WsServer } = require('./ws-server');
const processManager = require('./process-manager');

function getTools(): Array<{ name: string; description: string; inputSchema: object }> {
    return new ToolDefinitions().getTools();
}

module.exports = {
    createApp,
    getTools,
    ToolDefinitions,
    QueueManager,
    SessionManager,
    WsServer,
    processManager,
};
