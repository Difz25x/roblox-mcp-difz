

import * as fs from 'fs';
import * as path from 'path';
import { normalizeToolArguments } from './tool-definitions';

interface ToolDefInstance {
    getTools(): unknown[];
    getTool(name: string): unknown | undefined;
}

interface QueueManager {
    submitTask(type: string, args: Record<string, unknown>, opts?: { workerId?: string; timeoutMs?: number; targetPid?: number }): Promise<unknown>;
    getStats(): {
        pendingQueue: number;
        pendingResults: number;
        waitingPollers: number;
        totalSubmitted: number;
        totalProcessed: number;
    };
}

interface ActiveSession {
    workerId: string;
    pid?: number | string;
    name?: string;
    status: string;
    transport?: 'ws' | 'stream';
}

interface SessionManager {
    readonly activeCount: number;
    listActive?(): ActiveSession[];
    countByTransport?(): { ws: number; stream: number };
}

interface TransportControl {
    getMode(): 'auto' | 'ws' | 'stream';
    setMode(m: 'auto' | 'ws' | 'stream'): void;
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
    performScreenshot(pid?: number, outputPath?: string): Promise<{
        error?: string;
        needsDisambiguation?: boolean;
        windows?: Array<{ pid: number; hwnd: string; title: string }>;
        imageBase64?: string;
        filePath?: string;
        pid?: number;
    }>;
    recordVideo(pid?: number, duration?: number, outputPath?: string, fps?: number): Promise<{
        error?: string;
        needsDisambiguation?: boolean;
        windows?: Array<{ pid: number; hwnd: string; title: string }>;
        filePath?: string;
        pid?: number;
    }>;
}

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

const LUA_TASK_NAME_MAP: Record<string, string> = {
    'get-player': 'get-local-player',
    'get-players': 'dump-workspace-players',
    'list-remotes': 'dump-remote-events',
    'get-gui-tree': 'dump-gui-hierarchy',
    'get-screen-text': 'extract-screen-text',
    'get-script': 'get-script',
    'decompile-script': 'decompile-script',
    'get-remote-handlers': 'inspect-remote-connections',
    'set-player': 'modify-local-player',
    'teleport': 'teleport-player',
    'bypass-anticheat': 'disable-anticheat',
    'find-instances': 'get-instances-by-class',
};

const SERVER_SIDE_TOOLS = new Set<string>([
    'list-roblox-processes',
    'launch-roblox',
    'open-roblox-game',
    'take-screenshot',
    'record-roblox-video',
    'get-transport-status',
    'set-transport-mode',
]);

class McpHandler {
    private queue: QueueManager;
    private tools: ToolDefInstance;
    private sessions: SessionManager;
    private proc: ProcessManager;
    private transportControl?: TransportControl;
    private serverInfo: { name: string; version: string; description: string };
    private initialized: boolean;

    constructor(
        queue: QueueManager,
        tools: ToolDefInstance,
        sessions: SessionManager,
        processManager: ProcessManager,
        transportControl?: TransportControl
    ) {
        this.queue = queue;
        this.tools = tools;
        this.sessions = sessions;
        this.proc = processManager;
        this.transportControl = transportControl;
        this.serverInfo = {
            name: 'roblox-difz-server',
            version: '1.0.0',
            description:
                'Roblox MCP — full game control, reverse engineering, ' +
                'and security testing framework via Model Context Protocol.',
        };
        this.initialized = false;
    }

    async handleMessage(message: McpMessage): Promise<McpResult> {
        try {
            const { method, params } = message;

            if (!method) {
                return { error: { code: -32600, message: 'Invalid Request: method is required' } };
            }

            if (!this.initialized && method !== 'initialize' && method !== 'ping') {
                this.initialized = true; // Auto-initialize on direct tool call or dashboard runner
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

    private _handleInitialize(_params?: Record<string, unknown>): McpResult {
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

    private _handleShutdown(): McpResult {
        this.initialized = false;
        return { result: { success: true, message: 'Server shutting down' } };
    }

    private _handleToolsList(): McpResult {
        return { result: { tools: this.tools.getTools() } };
    }

    private async _handleToolsCall(params?: Record<string, unknown>): Promise<McpResult> {
        const { name, arguments: rawArgs } = (params || {}) as { name?: string; arguments?: Record<string, unknown> };

        if (!name) {
            return { error: { code: -32602, message: 'Tool name is required' } };
        }

        const tool = this.tools.getTool(name);
        if (!tool) {
            return { error: { code: -32602, message: `Unknown tool: ${name}` } };
        }

        const args = normalizeToolArguments(rawArgs);

        try {
            if (SERVER_SIDE_TOOLS.has(name)) {
                const result = await this._runServerTool(name, args || {});
                return {
                    result: {
                        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                        meta: { tool: name, execution: 'server' },
                    },
                };
            }

            if (name === 'execute-script' && args?.file) {
                const targetPath = path.resolve(String(args.file));
                const ext = path.extname(targetPath).toLowerCase();
                if (!['.lua', '.luau', '.txt'].includes(ext)) {
                    throw new Error(`Invalid script file type "${ext}". Only .lua, .luau, and .txt files are allowed.`);
                }
                const lower = targetPath.toLowerCase();
                if (lower.includes('\\windows\\') || lower.includes('/etc/') || lower.includes('/proc/')) {
                    throw new Error('Access to system paths is prohibited.');
                }
                if (!fs.existsSync(targetPath)) {
                    throw new Error(`File not found: ${targetPath}`);
                }
                args.code = fs.readFileSync(targetPath, 'utf-8');
            }

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
            const rawTarget = (args?.workerId || args?.worker_id || args?.sessionId || args?.session_id) as string | undefined;
            const targetPid = args?.pid !== undefined ? Number(args.pid) : undefined;
            const timeoutMs = args && (args.timeout_ms !== undefined || args.timeout !== undefined)
                ? Number(args.timeout_ms ?? args.timeout)
                : undefined;

            const taskName = LUA_TASK_NAME_MAP[name] || name;
            const activeSessions = this.sessions.listActive ? this.sessions.listActive() : [];

            // Resolve targetWorker dynamically (by exact workerId, PID, username, or substring)
            let resolvedWorkerId: string | undefined = undefined;
            if (rawTarget) {
                const targetStr = String(rawTarget).trim();
                const targetLower = targetStr.toLowerCase();
                const matched = activeSessions.find(s =>
                    s.workerId === targetStr ||
                    s.workerId.toLowerCase() === targetLower ||
                    (s.pid && String(s.pid) === targetStr) ||
                    (s.name && s.name.toLowerCase() === targetLower) ||
                    s.workerId.toLowerCase().includes(targetLower)
                );
                resolvedWorkerId = matched ? matched.workerId : targetStr;
            }

            // Case 1: Targeted by specific workerId / session
            if (resolvedWorkerId) {
                const result = await this.queue.submitTask(taskName, args || {}, { workerId: resolvedWorkerId, timeoutMs });
                const elapsed = Date.now() - startTime;
                return {
                    result: {
                        content: [{
                            type: 'text',
                            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                        }],
                        meta: { executionTimeMs: elapsed, tool: name, workerId: resolvedWorkerId },
                    },
                };
            }

            // Case 2: Targeted by specific PID
            if (targetPid !== undefined) {
                const result = await this.queue.submitTask(taskName, args || {}, { targetPid, timeoutMs });
                const elapsed = Date.now() - startTime;
                return {
                    result: {
                        content: [{
                            type: 'text',
                            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                        }],
                        meta: { executionTimeMs: elapsed, tool: name, targetPid },
                    },
                };
            }

            // Case 3: Exactly 1 session connected -> execute directly
            if (activeSessions.length <= 1) {
                const singleWorker = activeSessions[0]?.workerId;
                const result = await this.queue.submitTask(taskName, args || {}, { workerId: singleWorker, timeoutMs });
                const elapsed = Date.now() - startTime;
                return {
                    result: {
                        content: [{
                            type: 'text',
                            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                        }],
                        meta: { executionTimeMs: elapsed, tool: name, workerId: singleWorker },
                    },
                };
            }

            // Case 4: Multiple sessions connected and no target specified -> Fanout across all sessions
            const sessionResults: Record<string, any> = {};
            await Promise.all(activeSessions.map(async (worker: any) => {
                const wid = worker.workerId;
                try {
                    const res = await this.queue.submitTask(taskName, args || {}, { workerId: wid, timeoutMs: timeoutMs || 15000 });
                    sessionResults[wid] = {
                        success: true,
                        pid: worker.pid,
                        name: worker.name,
                        result: res,
                    };
                } catch (err: any) {
                    sessionResults[wid] = {
                        success: false,
                        pid: worker.pid,
                        name: worker.name,
                        error: err.message,
                    };
                }
            }));

            const elapsed = Date.now() - startTime;
            return {
                result: {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            multi_session: true,
                            total_sessions: activeSessions.length,
                            results: sessionResults,
                        }, null, 2),
                    }],
                    meta: { executionTimeMs: elapsed, tool: name, sessionsExecuted: activeSessions.length },
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

    private async _runServerTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
        const rawTarget = (args.workerId || args.worker_id || args.sessionId || args.session_id) as string | undefined;
        if (!args.pid && rawTarget) {
            const active = this.sessions.listActive ? this.sessions.listActive() : [];
            const targetStr = String(rawTarget).trim().toLowerCase();
            const matched = active.find(s =>
                s.workerId.toLowerCase() === targetStr ||
                (s.pid && String(s.pid) === targetStr) ||
                (s.name && s.name.toLowerCase() === targetStr) ||
                s.workerId.toLowerCase().includes(targetStr)
            );
            if (matched && matched.pid) {
                args.pid = Number(matched.pid);
            }
        }

        switch (name) {
            case 'list-roblox-processes': {
                const procs = this.proc.listRobloxProcesses();
                const active = this.sessions.listActive ? this.sessions.listActive() : [];
                const pidToSession = new Map<number, any>();
                for (const s of active) {
                    if (s.pid) pidToSession.set(Number(s.pid), s);
                }
                let connectedCount = 0;
                let unconnectedCount = 0;
                const enriched = procs.map((p: any) => {
                    const sess = pidToSession.get(p.pid);
                    const isConnected = !!sess;
                    if (isConnected) connectedCount++;
                    else unconnectedCount++;
                    return {
                        pid: p.pid,
                        name: p.name,
                        windowTitle: p.windowTitle,
                        memoryMB: p.memoryMB,
                        status: isConnected ? ('connected' as const) : ('unconnected' as const),
                        workerId: sess ? sess.workerId : null,
                        transport: sess ? (sess.transport || 'ws') : null,
                        player: sess ? sess.name : null,
                    };
                });
                return {
                    success: true,
                    total: procs.length,
                    status: {
                        connected: connectedCount,
                        unconnected: unconnectedCount,
                    },
                    processes: enriched,
                };
            }

            case 'launch-roblox':
                return this.proc.launchRoblox((args.path as string) || null);

            case 'open-roblox-game': {
                const placeId = (args.place_id || args.placeId) as string | number;
                if (!placeId) return { success: false, error: "place_id is required" };
                return this.proc.openGame(placeId, {
                    jobId: (args.job_id || args.jobId) as string | undefined,
                    privateServerLinkCode: (args.private_server_link_code || args.privateServerLinkCode) as string | undefined,
                    browserTrackerId: (args.browser_tracker_id || args.browserTrackerId) as string | undefined,
                    launchTime: (args.launch_time || args.launchTime) as string | undefined,
                    launchMode: (args.launch_mode || args.launchMode) as string | undefined,
                    authTicket: (args.auth_ticket || args.authTicket) as string | undefined,
                    experienceId: (args.experience_id || args.experienceId) as string | undefined,
                });
            }

            case 'take-screenshot': {
                const ssResult = await this.proc.performScreenshot(
                    args.pid ? Number(args.pid) : undefined,
                    (args.output_path as string) || undefined
                );
                if (ssResult.error) return { success: false, error: ssResult.error };
                if (ssResult.needsDisambiguation) {
                    return { success: true, needsDisambiguation: true, windows: ssResult.windows };
                }
                if (ssResult.filePath && !ssResult.imageBase64) {
                    return { success: true, file_path: ssResult.filePath, pid: ssResult.pid ?? args.pid ?? null };
                }
                return {
                    success: true,
                    image: `data:image/png;base64,${ssResult.imageBase64}`,
                    file_path: ssResult.filePath,
                    pid: ssResult.pid ?? args.pid ?? null,
                };
            }

            case 'record-roblox-video': {
                const vidResult = await this.proc.recordVideo(
                    args.pid ? Number(args.pid) : undefined,
                    args.duration_seconds ? Number(args.duration_seconds) : 5,
                    (args.output_path as string) || undefined,
                    args.fps ? Number(args.fps) : 30
                );
                if (vidResult.error) return { success: false, error: vidResult.error };
                if (vidResult.needsDisambiguation) {
                    return { success: true, needsDisambiguation: true, windows: vidResult.windows };
                }
                return { success: true, file_path: vidResult.filePath, pid: vidResult.pid ?? args.pid ?? null };
            }

            case 'get-transport-status': {
                const procs = this.proc.listRobloxProcesses();
                const active = this.sessions.listActive ? this.sessions.listActive() : [];
                const pidToSession = new Map<number, any>();
                for (const s of active) {
                    if (s.pid) pidToSession.set(Number(s.pid), s);
                }
                let connectedCount = 0;
                let unconnectedCount = 0;
                const enriched = procs.map((p: any) => {
                    const sess = pidToSession.get(p.pid);
                    const isConnected = !!sess;
                    if (isConnected) connectedCount++;
                    else unconnectedCount++;
                    return {
                        pid: p.pid,
                        name: p.name,
                        windowTitle: p.windowTitle,
                        memoryMB: p.memoryMB,
                        status: isConnected ? ('connected' as const) : ('unconnected' as const),
                        workerId: sess ? sess.workerId : null,
                        transport: sess ? (sess.transport || 'ws') : null,
                    };
                });
                const counts = this.sessions.countByTransport ? this.sessions.countByTransport() : { ws: 0, stream: 0 };
                const mode = this.transportControl ? this.transportControl.getMode() : 'auto';
                const activeTransport = counts.stream > 0 ? 'stream' : (counts.ws > 0 ? 'ws' : (mode === 'auto' ? 'ws' : mode));
                return {
                    success: true,
                    mode,
                    activeTransport,
                    streamWorkers: counts.stream,
                    wsWorkers: counts.ws,
                    status: {
                        connected: connectedCount,
                        unconnected: unconnectedCount,
                    },
                    activeSessions: active,
                    processes: enriched,
                    queueStats: this.queue.getStats(),
                };
            }

            case 'set-transport-mode': {
                const mode = String(args.mode || '').toLowerCase() as 'auto' | 'ws' | 'stream';
                if (!['auto', 'ws', 'stream'].includes(mode)) {
                    return { success: false, error: "mode must be 'auto', 'ws', or 'stream'" };
                }
                if (this.transportControl) {
                    this.transportControl.setMode(mode);
                }
                return { success: true, mode };
            }

            default:
                return { success: false, error: `Unknown server tool: ${name}` };
        }
    }

    private _handleResourcesList(): McpResult {
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

    private async _handleResourcesRead(params?: Record<string, unknown>): Promise<McpResult> {
        const uri = (params?.uri as string) || '';
        const RESOURCE_MAP: Record<string, string> = {
            'mcp://roblox/game/metadata': 'get-metadata',
            'mcp://roblox/game/players': 'dump-workspace-players',
            'mcp://roblox/game/remotes': 'dump-remote-events',
            'mcp://roblox/game/workspace': 'get_workspace_objects',
            'mcp://roblox/game/console': 'get-console-logs',
        };

        const toolName = RESOURCE_MAP[uri];
        if (!toolName) {
            return { error: { code: -32602, message: `Unknown resource URI: ${uri}` } };
        }

        if (this.sessions.activeCount === 0) {
            return {
                result: {
                    contents: [{
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify({ success: false, error: 'No Roblox executor connected' })
                    }]
                }
            };
        }

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

    private _handlePromptsList(): McpResult {
        return {
            result: {
                prompts: [
                    { name: 'analyze_game', description: 'Dumps game metadata, remotes, and player data in one shot.', arguments: [] },
                    { name: 'audit_game_security', description: 'Inspect game network remotes and workspace scripts to evaluate security integrity.', arguments: [] },
                ],
            },
        };
    }

    private async _handlePromptsGet(params?: Record<string, unknown>): Promise<McpResult> {
        const name = params?.name as string;
        if (name === 'analyze_game') {
            return {
                result: {
                    description: 'Dumps game metadata, remotes, and player data in one shot.',
                    messages: [
                        { role: 'user', content: { type: 'text', text: 'Call the tools: get_game_metadata, dump_workspace_players, and dump_remote_events. Synthesize a report on the current game state and active players.' } }
                    ]
                }
            };
        }
        if (name === 'audit_game_security') {
            return {
                result: {
                    description: 'Inspect game network remotes and workspace scripts to evaluate security integrity.',
                    messages: [
                        { role: 'user', content: { type: 'text', text: 'Call dump_remote_events to inspect active network endpoints. Review parameters and event handlers to verify that game network interactions are appropriately validated.' } }
                    ]
                }
            };
        }
        return { error: { code: -32602, message: `Unknown prompt: ${name}` } };
    }

    private _handleSetup(): McpResult {
        const port = process.env.MCP_PORT || 28429;
        return {
            result: {
                success: true,
                message: 'To install to Claude Desktop/Code, use the CLI wizard (`roblox-mcp-difz setup`).',
                url: `http://localhost:${port}/mcp`,
            },
        };
    }
}

module.exports = { McpHandler };
