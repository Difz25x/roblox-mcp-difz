/**
 * index.js — Programmatic entry for roblox-mcp
 *
 * Usage:
 *   const robloxMcp = require('roblox-mcp');
 *   const { app, queue, tools } = robloxMcp.createApp({ verbose: true });
 *   app.listen(28429);
 *
 *   console.log('Tools:', robloxMcp.getTools().length);
 */
const { createApp } = require('./server-core');
const { ToolDefinitions } = require('./tool-definitions');
const { QueueManager } = require('./queue-manager');

function getTools() {
    return new ToolDefinitions().getTools();
}

module.exports = {
    createApp,
    getTools,
    ToolDefinitions,
    QueueManager,
};
