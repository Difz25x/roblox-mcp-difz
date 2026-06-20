/**
 * mcp-handler.js
 *
 * MCP (Model Context Protocol) JSON-RPC 2.0 message handler.
 *
 * Server-side tools (get_roblox_processes, launch_roblox, open_game, etc.)
 * are executed directly on Node — not sent to the executor queue.
 */
const { ToolDefinitions } = require('./tool-definitions');

/** Tools that run on the Node server directly, not via executor */
const SERVER_SIDE_TOOLS = new Set([
    'get_roblox_processes',
    'launch_roblox',
    'open_game',
    'capture_roblox_screenshot',
    'get_roblox_versions',
]);

class McpHandler {
    /**
     * @param {import('./queue-manager').QueueManager} queue
     * @param {ToolDefinitions} tools
     * @param {import('./session-manager').SessionManager} sessions
     * @param {object} processManager
     */
    constructor(queue, tools, sessions, processManager) {
        this.queue = queue;
        this.tools = tools;
        this.sessions = sessions;
        this.proc = processManager;
        this.serverInfo = {
            name: 'roblox-mcp-difz-server',
            version: '1.0.0',
            description:
                'Roblox MCP — full game control, reverse engineering, ' +
                'and exploitation framework via Model Context Protocol.',
        };
        this.initialized = false;
    }

    async handleMessage(message) {
        const { method, params } = message;

        if (!method) {
            return { error: { code: -32600, message: 'Invalid Request: method is required' } };
        }

        switch (method) {
            case 'initialize':
                return this._handleInitialize(params);
            case 'shutdown':
                return this._handleShutdown();
            case 'notifications/initialized':
                return { result: { acknowledged: true } };
            case 'tools/list':
                return this._handleToolsList();
            case 'tools/call':
                return await this._handleToolsCall(params);
            case 'resources/list':
                return this._handleResourcesList();
            case 'resources/read':
                return await this._handleResourcesRead(params);
            case 'prompts/list':
                return this._handlePromptsList();
            case 'ping':
                return { result: { status: 'pong', timestamp: Date.now(), stats: this.queue.getStats() } };
            case 'mcp/setup':
                return this._handleSetup();
            default:
                return { error: { code: -32601, message: `Method not found: ${method}` } };
        }
    }

    _handleInitialize(params) {
        this.initialized = true;
        return {
            result: {
                protocolVersion: '2024-11-05',
                capabilities: {
                    tools: { listChanged: false },
                    resources: { listChanged: false, subscribe: false },
                    prompts: {},
                },
                serverInfo: this.serverInfo,
            },
        };
    }

    _handleShutdown() {
        this.initialized = false;
        return { result: { success: true, message: 'Server shutting down' } };
    }

    _handleToolsList() {
        return { result: { tools: this.tools.getTools() } };
    }

    async _handleToolsCall(params) {
        const { name, arguments: args } = params || {};

        if (!name) {
            return { error: { code: -32602, message: 'Tool name is required' } };
        }

        const tool = this.tools.getTool(name);
        if (!tool) {
            return { error: { code: -32602, message: `Unknown tool: ${name}` } };
        }

        try {
            // Server-side tools run on Node directly
            if (SERVER_SIDE_TOOLS.has(name)) {
                const result = this._runServerTool(name, args || {});
                return {
                    result: {
                        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                        meta: { tool: name, execution: 'server' },
                    },
                };
            }

            // Executor tools — queue for executor, with optional workerId targeting
            const startTime = Date.now();
            const workerId = (args && args.pid) ? String(args.pid) : undefined;
            const result = await this.queue.submitTask(name, args || {}, { workerId });
            const elapsed = Date.now() - startTime;

            return {
                result: {
                    content: [{
                        type: 'text',
                        text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                    }],
                    meta: { executionTimeMs: elapsed, tool: name },
                },
            };
        } catch (err) {
            return {
                result: {
                    content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }],
                    isError: true,
                    meta: { tool: name, error: err.message },
                },
            };
        }
    }

    _runServerTool(name, args) {
        switch (name) {
            case 'get_roblox_processes':
                return { success: true, processes: this.proc.listRobloxProcesses(), count: this.sessions.activeCount };

            case 'launch_roblox':
                return this.proc.launchRoblox(args.path || null);

            case 'open_game':
                return this.proc.openGame(args.place_id, {
                    jobId: args.job_id,
                    privateServerLinkCode: args.private_server_link_code,
                    browserTrackerId: args.browser_tracker_id,
                    launchTime: args.launch_time,
                    launchMode: args.launch_mode,
                    authTicket: args.auth_ticket,
                    experienceId: args.experience_id,
                });

            case 'capture_roblox_screenshot':
                return this.proc.captureRobloxWindow(args.pid || null);

            case 'get_roblox_versions':
                return this._getRobloxVersions();

            default:
                return { success: false, error: `Unknown server tool: ${name}` };
        }
    }

    _getRobloxVersions() {
        const fs = require('fs');
        const path = require('path');
        const versions = [];
        const candidates = [
            process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Roblox', 'Versions') : '',
            'C:\\Program Files (x86)\\Roblox\\Versions',
            'C:\\Program Files\\Roblox\\Versions',
        ];
        for (const dir of candidates) {
            if (!dir || !fs.existsSync(dir)) continue;
            try {
                const entries = fs.readdirSync(dir).filter(v => v.startsWith('version-')).sort().reverse();
                for (const ver of entries) {
                    const launcher = path.join(dir, ver, 'RobloxPlayerLauncher.exe');
                    const player = path.join(dir, ver, 'RobloxPlayerBeta.exe');
                    versions.push({
                        version: ver.replace('version-', ''),
                        path: dir + '/' + ver,
                        hasPlayerLauncher: fs.existsSync(launcher),
                        hasPlayerBeta: fs.existsSync(player),
                    });
                }
            } catch {}
        }
        return { success: true, versions };
    }

    _handleResourcesList() {
        return {
            result: {
                resources: [
                    { uri: 'mcp://roblox/game/metadata', name: 'Game Metadata', description: 'Current game session metadata', mimeType: 'application/json' },
                    { uri: 'mcp://roblox/game/players', name: 'Active Players', description: 'Real-time player data', mimeType: 'application/json' },
                    { uri: 'mcp://roblox/game/remotes', name: 'Remote Events & Functions', description: 'All detected remotes', mimeType: 'application/json' },
                    { uri: 'mcp://roblox/game/workspace', name: 'Workspace Objects', description: '3D object tree', mimeType: 'application/json' },
                    { uri: 'mcp://roblox/game/console', name: 'Console Logs', description: 'Recent LogService output', mimeType: 'application/json' },
                ],
            },
        };
    }

    async _handleResourcesRead(params) {
        const { uri } = params || {};
        if (!uri) return { error: { code: -32602, message: 'Resource URI is required' } };

        const resourceMap = {
            'mcp://roblox/game/metadata': 'get_game_metadata',
            'mcp://roblox/game/players': 'dump_workspace_players',
            'mcp://roblox/game/remotes': 'dump_remote_events',
            'mcp://roblox/game/workspace': 'get_workspace_objects',
            'mcp://roblox/game/console': 'get_console_logs',
        };

        const toolName = resourceMap[uri];
        if (!toolName) return { error: { code: -32602, message: `Unknown resource: ${uri}` } };

        try {
            const result = await this.queue.submitTask(toolName, {});
            return {
                result: {
                    contents: [{
                        uri,
                        mimeType: 'application/json',
                        text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                    }],
                },
            };
        } catch (err) {
            return { error: { code: -32603, message: `Failed to read resource: ${err.message}` } };
        }
    }

    _handlePromptsList() {
        return {
            result: {
                prompts: [
                    { name: 'analyze_game', description: 'Dumps game metadata, remotes, and player data in one shot.', arguments: [] },
                    { name: 'find_exploit_vector', description: 'Scan remotes and workspace to find exploit entry points.', arguments: [] },
                ],
            },
        };
    }

    _handleSetup() {
        return {
            result: {
                config: {
                    type: 'url',
                    url: 'http://localhost:28429/mcp',
                    name: 'Roblox MCP Difz',
                    description: 'Full game control & exploitation framework',
                },
            },
        };
    }
}

module.exports = { McpHandler };