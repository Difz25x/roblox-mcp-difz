/**
 * mcp-handler.js
 *
 * MCP (Model Context Protocol) JSON-RPC 2.0 message handler.
 *
 * Implements:
 *   - initialize / shutdown       (lifecycle)
 *   - tools/list  / tools/call    (tool operations)
 *   - resources/list / resources/read  (resource operations)
 *   - ping                        (health)
 *
 * Tools/call bridges to the QueueManager so the executor picks up the task.
 */
const { ToolDefinitions } = require('./tool-definitions');

class McpHandler {
    /**
     * @param {import('./queue-manager').QueueManager} queue
     * @param {ToolDefinitions} tools
     */
    constructor(queue, tools) {
        this.queue = queue;
        this.tools = tools;
        this.serverInfo = {
            name: 'roblox-mcp-server',
            version: '2.0.0',
            description:
                'Roblox MCP — full game control, reverse engineering, ' +
                'and exploitation framework via Model Context Protocol.',
        };
        this.initialized = false;
    }

    /**
     * Dispatch an incoming JSON-RPC 2.0 message to the appropriate handler.
     *
     * @param {{method: string, params?: any, id?: any}} message
     * @returns {Promise<{result?: any, error?: {code: number, message: string}}>}
     */
    async handleMessage(message) {
        const { method, params } = message;

        if (!method) {
            return { error: { code: -32600, message: 'Invalid Request: method is required' } };
        }

        switch (method) {
            // --- Lifecycle ---
            case 'initialize':
                return this._handleInitialize(params);
            case 'shutdown':
                return this._handleShutdown();
            case 'notifications/initialized':
                return { result: { acknowledged: true } };

            // --- Tools ---
            case 'tools/list':
                return this._handleToolsList();
            case 'tools/call':
                return await this._handleToolsCall(params);

            // --- Resources ---
            case 'resources/list':
                return this._handleResourcesList();
            case 'resources/read':
                return await this._handleResourcesRead(params);

            // --- Prompts ---
            case 'prompts/list':
                return this._handlePromptsList();

            // --- Utility ---
            case 'ping':
                return { result: { status: 'pong', timestamp: Date.now(), stats: this.queue.getStats() } };
            case 'mcp/setup':
                return this._handleSetup();

            default:
                return { error: { code: -32601, message: `Method not found: ${method}` } };
        }
    }

    // ----------------------------------------------------------------
    // Lifecycle
    // ----------------------------------------------------------------

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

    // ----------------------------------------------------------------
    // Tools
    // ----------------------------------------------------------------

    _handleToolsList() {
        return {
            result: {
                tools: this.tools.getTools(),
            },
        };
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
            const startTime = Date.now();
            const result = await this.queue.submitTask(name, args || {});
            const elapsed = Date.now() - startTime;

            return {
                result: {
                    content: [
                        {
                            type: 'text',
                            text:
                                typeof result === 'string'
                                    ? result
                                    : JSON.stringify(result, null, 2),
                        },
                    ],
                    meta: {
                        executionTimeMs: elapsed,
                        tool: name,
                    },
                },
            };
        } catch (err) {
            return {
                result: {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: false,
                                error: err.message,
                            }),
                        },
                    ],
                    isError: true,
                    meta: {
                        tool: name,
                        error: err.message,
                    },
                },
            };
        }
    }

    // ----------------------------------------------------------------
    // Resources
    // ----------------------------------------------------------------

    _handleResourcesList() {
        return {
            result: {
                resources: [
                    {
                        uri: 'mcp://roblox/game/metadata',
                        name: 'Game Metadata',
                        description: 'Current game session metadata (PlaceId, JobId, players, etc.)',
                        mimeType: 'application/json',
                    },
                    {
                        uri: 'mcp://roblox/game/players',
                        name: 'Active Players',
                        description: 'Real-time data for every player in the server',
                        mimeType: 'application/json',
                    },
                    {
                        uri: 'mcp://roblox/game/remotes',
                        name: 'Remote Events & Functions',
                        description: 'All detected remotes and their paths',
                        mimeType: 'application/json',
                    },
                    {
                        uri: 'mcp://roblox/game/workspace',
                        name: 'Workspace Objects',
                        description: '3D object tree with positions and properties',
                        mimeType: 'application/json',
                    },
                    {
                        uri: 'mcp://roblox/game/console',
                        name: 'Console Logs',
                        description: 'Recent LogService output',
                        mimeType: 'application/json',
                    },
                ],
            },
        };
    }

    async _handleResourcesRead(params) {
        const { uri } = params || {};

        if (!uri) {
            return { error: { code: -32602, message: 'Resource URI is required' } };
        }

        const resourceMap = {
            'mcp://roblox/game/metadata': 'get_game_metadata',
            'mcp://roblox/game/players': 'dump_workspace_players',
            'mcp://roblox/game/remotes': 'dump_remote_events',
            'mcp://roblox/game/workspace': 'get_workspace_objects',
            'mcp://roblox/game/console': 'get_console_logs',
        };

        const toolName = resourceMap[uri];

        if (!toolName) {
            return { error: { code: -32602, message: `Unknown resource: ${uri}` } };
        }

        try {
            const result = await this.queue.submitTask(toolName, {});
            return {
                result: {
                    contents: [
                        {
                            uri,
                            mimeType: 'application/json',
                            text:
                                typeof result === 'string'
                                    ? result
                                    : JSON.stringify(result, null, 2),
                        },
                    ],
                },
            };
        } catch (err) {
            return {
                error: {
                    code: -32603,
                    message: `Failed to read resource: ${err.message}`,
                },
            };
        }
    }

    // ----------------------------------------------------------------
    // Prompts
    // ----------------------------------------------------------------

    _handlePromptsList() {
        return {
            result: {
                prompts: [
                    {
                        name: 'analyze_game',
                        description:
                            'Beginner-friendly analysis: dumps game metadata, remotes, ' +
                            'and player data in one shot.',
                        arguments: [],
                    },
                    {
                        name: 'find_exploit_vector',
                        description:
                            'Scan remotes and workspace to find potential exploit ' +
                            'entry points.',
                        arguments: [],
                    },
                ],
            },
        };
    }

    // ----------------------------------------------------------------
    // Utility
    // ----------------------------------------------------------------

    _handleSetup() {
        return {
            result: {
                config: {
                    type: 'url',
                    url: 'http://localhost:28429/mcp',
                    name: 'Roblox MCP',
                    description: 'Full game control & exploitation framework',
                },
            },
        };
    }
}

module.exports = { McpHandler };
