/**
 * mcp-handler.ts
 *
 * MCP (Model Context Protocol) JSON-RPC 2.0 message handler.
 *
 * Server-side tools (get_roblox_processes, launch_roblox, open_game, etc.)
 * are executed directly on Node — not sent to the executor queue.
 */

// ToolDefinitions — used only as a type for the constructor parameter
interface ToolDefInstance {
    getTools(): unknown[];
    getTool(name: string): unknown | undefined;
}

// ---- Type definitions for constructor parameters ----

interface QueueManager {
    submitTask(type: string, args: Record<string, unknown>, opts?: { workerId?: string; timeoutMs?: number }): Promise<unknown>;
    getStats(): {
        pendingQueue: number;
        pendingResults: number;
        waitingPollers: number;
        totalSubmitted: number;
        totalProcessed: number;
    };
}

interface SessionManager {
    readonly activeCount: number;
}

interface ProcessManager {
    listRobloxProcesses(): Array<{
        pid: number;
        name: string;
        windowTitle: string;
        memoryMB: number;
    }>;
    launchRoblox(customPath: string | null): { success: boolean; pid?: number; path?: string; error?: string };
    openGame(
        placeId: string | number,
        opts: {
            jobId?: string;
            privateServerLinkCode?: string;
            browserTrackerId?: string;
            launchTime?: string;
            launchMode?: string;
            authTicket?: string;
            experienceId?: string;
        }
    ): { success: boolean; launchUrl?: string; error?: string };
    performScreenshot(pid?: number): {
        error?: string;
        needsDisambiguation?: boolean;
        windows?: Array<{ pid: number; hwnd: string; title: string }>;
        imageBase64?: string;
    };
}

// ---- Internal types ----

interface McpMessage {
    method?: string;
    params?: Record<string, unknown>;
}

interface McpError {
    code: number;
    message: string;
}

interface McpResult {
    result?: unknown;
    error?: McpError;
}

/** Tools that run on the Node server directly, not via executor */
const SERVER_SIDE_TOOLS = new Set<string>([
    'get_roblox_processes',
    'launch_roblox',
    'open_game',
    'capture_roblox_screenshot',
    'get_roblox_versions',
]);

class McpHandler {
    private queue: QueueManager;
    private tools: ToolDefInstance;
    private sessions: SessionManager;
    private proc: ProcessManager;
    private serverInfo: { name: string; version: string; description: string };
    private initialized: boolean;

    /**
     * @param queue - The task queue manager
     * @param tools - Tool definitions registry
     * @param sessions - Session manager
     * @param processManager - Process manager module
     */
    constructor(queue: QueueManager, tools: ToolDefInstance, sessions: SessionManager, processManager: ProcessManager) {
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

    async handleMessage(message: McpMessage): Promise<McpResult> {
        try {
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
                case 'prompts/get':
                    return await this._handlePromptsGet(params);
                case 'ping':
                    return { result: { status: 'pong', timestamp: Date.now(), stats: this.queue.getStats() } };
                case 'mcp/setup':
                    return this._handleSetup();
                default:
                    return { error: { code: -32601, message: `Method not found: ${method}` } };
            }
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            return { error: { code: -32603, message: `Internal handler error: ${errorMessage}` } };
        }
    }

    _handleInitialize(_params?: Record<string, unknown>): McpResult {
        this.initialized = true;
        return {
            result: {
                protocolVersion: '2024-11-05',
                capabilities: {
                    tools: { listChanged: false },
                    resources: { listChanged: false, subscribe: false },
                    prompts: { listChanged: false },
                },
                serverInfo: this.serverInfo,
            },
        };
    }

    _handleShutdown(): McpResult {
        this.initialized = false;
        return { result: { success: true, message: 'Server shutting down' } };
    }

    _handleToolsList(): McpResult {
        return { result: { tools: this.tools.getTools() } };
    }

    async _handleToolsCall(params?: Record<string, unknown>): Promise<McpResult> {
        const { name, arguments: args } = (params || {}) as { name?: string; arguments?: Record<string, unknown> };

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

            // Executor tools — queue for executor, with optional PID targeting
            // If no executor is connected, fail fast instead of waiting for timeout
            if (this.sessions.activeCount === 0) {
                return {
                    result: {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                success: false,
                                error: 'No Roblox executor is connected. Launch or inject Roblox first.',
                            }, null, 2),
                        }],
                        isError: true,
                        meta: { tool: name },
                    },
                };
            }

            const startTime = Date.now();
            const opts: any = {};
            if (args && args.pid) {
                const parsedPid = typeof args.pid === 'number' ? args.pid : Number(args.pid);
                if (!isNaN(parsedPid)) opts.targetPid = parsedPid;
            }
            const result = await this.queue.submitTask(name, args || {}, opts);
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
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            return {
                result: {
                    content: [{ type: 'text', text: JSON.stringify({ success: false, error: errorMessage }) }],
                    isError: true,
                    meta: { tool: name, error: errorMessage },
                },
            };
        }
    }

    _runServerTool(name: string, args: Record<string, unknown>): Record<string, unknown> {
        switch (name) {
            case 'get_roblox_processes':
                return { success: true, processes: this.proc.listRobloxProcesses(), count: this.sessions.activeCount };

            case 'launch_roblox':
                return this.proc.launchRoblox((args.path as string) || null);

            case 'open_game':
                return this.proc.openGame(args.place_id as string | number, {
                    jobId: args.job_id as string | undefined,
                    privateServerLinkCode: args.private_server_link_code as string | undefined,
                    browserTrackerId: args.browser_tracker_id as string | undefined,
                    launchTime: args.launch_time as string | undefined,
                    launchMode: args.launch_mode as string | undefined,
                    authTicket: args.auth_ticket as string | undefined,
                    experienceId: args.experience_id as string | undefined,
                });

            case 'capture_roblox_screenshot': {
                const ssResult = this.proc.performScreenshot(args.pid ? Number(args.pid) : undefined);
                if (ssResult.error) return { success: false, error: ssResult.error };
                if (ssResult.needsDisambiguation) {
                    return { success: true, needsDisambiguation: true, windows: ssResult.windows };
                }
                return { success: true, image: `data:image/png;base64,${ssResult.imageBase64}`, pid: args.pid || null };
            }

            case 'get_roblox_versions':
                return this._getRobloxVersions();

            default:
                return { success: false, error: `Unknown server tool: ${name}` };
        }
    }

    _getRobloxVersions(): { success: boolean; versions: Array<Record<string, unknown>> } {
        const fs = require('fs') as typeof import('fs');
        const path = require('path') as typeof import('path');
        const versions: Array<Record<string, unknown>> = [];
        const candidates: string[] = [
            process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA as string, 'Roblox', 'Versions') : '',
            'C:\\Program Files (x86)\\Roblox\\Versions',
            'C:\\Program Files\\Roblox\\Versions',
        ];
        for (const dir of candidates) {
            if (!dir || !fs.existsSync(dir)) continue;
            try {
                const entries = fs.readdirSync(dir).filter((v: string) => v.startsWith('version-')).sort().reverse();
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
            } catch {
                // ignore inaccessible directories
            }
        }
        return { success: true, versions };
    }

    _handleResourcesList(): McpResult {
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

    async _handleResourcesRead(params?: Record<string, unknown>): Promise<McpResult> {
        const { uri } = (params || {}) as { uri?: string };
        if (!uri) return { error: { code: -32602, message: 'Resource URI is required' } };

        const resourceMap: Record<string, string> = {
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
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            return { error: { code: -32603, message: `Failed to read resource: ${errorMessage}` } };
        }
    }

    _handlePromptsList(): McpResult {
        return {
            result: {
                prompts: [
                    { name: 'analyze_game', description: 'Dumps game metadata, remotes, and player data in one shot.', arguments: [] },
                    { name: 'find_exploit_vector', description: 'Scan remotes and workspace to find exploit entry points.', arguments: [] },
                ],
            },
        };
    }

    async _handlePromptsGet(params?: Record<string, unknown>): Promise<McpResult> {
        const name = (params && params.name) as string | undefined;
        if (!name) {
            return { error: { code: -32602, message: 'Prompt name is required' } };
        }
        if (name === 'analyze_game') {
            return {
                result: {
                    description: 'Dumps game metadata, remotes, and player data in one shot.',
                    messages: [
                        { role: 'user', content: { type: 'text', text: 'Run get_game_metadata, dump_remote_events, and dump_workspace_players. Return all results in a single structured report.' } },
                    ],
                },
            };
        }
        if (name === 'find_exploit_vector') {
            return {
                result: {
                    description: 'Scan remotes and workspace to find exploit entry points.',
                    messages: [
                        { role: 'user', content: { type: 'text', text: 'Scan all RemoteEvents/RemoteFunctions for connections and ownership. Check workspace for exploitable parts. Look for vulnerable clickdetectors and proximity prompts. Return a prioritized list of exploit vectors.' } },
                    ],
                },
            };
        }
        return { error: { code: -32602, message: `Unknown prompt: ${name}` } };
    }

    _handleSetup(): McpResult {
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
