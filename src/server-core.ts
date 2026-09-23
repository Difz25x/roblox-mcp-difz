

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
    let transportMode: 'auto' | 'ws' | 'stream' = (process.env.MCP_TRANSPORT as any) || 'auto';
    let autoexecuteEnabled: boolean = true;
    const transportControl = {
        getMode: () => transportMode,
        setMode: (m: 'auto' | 'ws' | 'stream') => { transportMode = m; },
        isAutoexecute: () => autoexecuteEnabled,
        setAutoexecute: (v: boolean) => { autoexecuteEnabled = v; },
    };

    const queue = new QueueManagerCls();
    const tools = new ToolDefinitionsCls();
    const sessions = new SessionManagerCls();
    const mcp = new McpHandlerCls(queue, tools, sessions, processManager, transportControl);

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

    const mcpLuaPath: string = path.join(PKG_DIR, 'public', 'mcp.lua');

    const serveMcpLua: RequestHandler = (_req: Request, res: Response): void => {
        try {
            if (fs.existsSync(mcpLuaPath)) {
                const content = fs.readFileSync(mcpLuaPath, 'utf-8');
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.send(content);
                return;
            }
        } catch {}
        res.status(404).send('-- mcp.lua not found.');
    };

    app.get('/mcp.lua', serveMcpLua);
    app.get('/mcp.luau', serveMcpLua);
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
            server: 'roblox-difz',
            version: PKG.version,
            tools: tools.count,
            transport: `http+${transportMode}`,
            http: `http://${host}:${port}/mcp`,
            ws: `ws://${host}:${port}/ws`,
            stream: `http://${host}:${port}/stream`,
            info: `http://${host}:${port}/type`,
        });
    });

    app.get('/api/transport', (_req: Request, res: Response): void => {
        const port = parseInt(process.env.MCP_PORT!, 10) || 28429;
        const host = _req.hostname || 'localhost';
        const counts = sessions.countByTransport ? sessions.countByTransport() : { ws: 0, stream: 0 };
        const activeTransport = counts.stream > 0 ? 'stream' : (counts.ws > 0 ? 'ws' : (transportMode === 'auto' ? 'ws' : transportMode));
        res.json({
            mode: transportMode,
            active_transport: activeTransport,
            ws_url: `ws://${host}:${port}/ws`,
            stream_urls: {
                register: `http://${host}:${port}/stream/register`,
                poll: `http://${host}:${port}/stream/poll`,
                result: `http://${host}:${port}/stream/result`,
                ping: `http://${host}:${port}/stream/ping`,
            },
            ws_clients: wss.connectedCount,
            stream_workers: counts.stream,
            active_sessions: sessions.activeCount,
        });
    });

    app.post('/api/transport', (req: Request, res: Response): void => {
        const { mode } = req.body || {};
        if (mode && ['auto', 'ws', 'stream'].includes(mode)) {
            transportMode = mode;
            res.json({ success: true, mode: transportMode });
        } else {
            res.status(400).json({ success: false, error: "mode must be 'auto', 'ws', or 'stream'" });
        }
    });

    app.post('/stream/register', (req: Request, res: Response): void => {
        const { worker_id, username, pid, placeId, jobId, placeName, capabilities } = req.body || {};
        if (!worker_id) {
            res.status(400).json({ success: false, error: 'worker_id is required' });
            return;
        }
        sessions.register(worker_id, {
            pid,
            name: username || 'RobloxStreamWorker',
            transport: 'stream',
            capabilities,
        });
        console.log(`[Stream] Registered: ${worker_id}${pid ? ' pid=' + pid : ''} "${placeName || ''}"`);
        res.json({
            success: true,
            worker_id,
            mode: transportMode,
            registered_at: Date.now(),
        });
    });

    const handleStreamPoll: RequestHandler = async (req: Request, res: Response): Promise<void> => {
        const workerId = (req.query.worker_id as string) || (req.body && req.body.worker_id) || undefined;
        const timeoutMs = parseInt((req.query.timeout as string) || (req.body && req.body.timeout), 10) || 20000;

        if (workerId && sessions.touch) {
            sessions.touch(workerId);
        }

        try {
            const task = await queue.waitForTask(Math.min(timeoutMs, 30000), workerId);
            if (task) {
                res.json({ success: true, task });
            } else {
                res.json({ success: true, task: null, status: 'timeout' });
            }
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    };
    app.get('/stream/poll', handleStreamPoll);
    app.post('/stream/poll', handleStreamPoll);

    app.post('/stream/result', (req: Request, res: Response): void => {
        const { id, data, error, worker_id } = req.body || {};
        if (!id) {
            res.status(400).json({ success: false, error: 'task id is required' });
            return;
        }
        if (worker_id && sessions.touch) {
            sessions.touch(worker_id);
        }
        const resolved = queue.resolveTask(id, data, error);
        res.json({ success: resolved });
    });

    app.post('/stream/ping', (req: Request, res: Response): void => {
        const { worker_id } = req.body || {};
        if (worker_id && sessions.touch) {
            sessions.touch(worker_id);
        }
        res.json({ success: true, timestamp: Date.now() });
    });

    app.get('/api/autoexecute', (_req: Request, res: Response): void => {
        res.json({
            success: true,
            enabled: autoexecuteEnabled,
            script: `loadstring(game:HttpGet("http://localhost:${parseInt(process.env.MCP_PORT!, 10) || 28429}/mcp.lua"))()`,
        });
    });

    app.post('/api/autoexecute', (req: Request, res: Response): void => {
        const { enabled } = req.body || {};
        autoexecuteEnabled = enabled !== undefined ? !!enabled : !autoexecuteEnabled;
        res.json({ success: true, enabled: autoexecuteEnabled });
    });

    app.get('/api/tools', (_req: Request, res: Response): void => {
        const allTools = tools.getTools();
        const categorized = allTools.map((t: any) => {
            let category = 'other';
            const n = t.name;
            if (['list-remotes', 'dump-remote-events', 'fire-remote', 'spy-remotes', 'block-remote', 'spoof-remote-args', 'set-remote-filter', 'toggle-remote-killswitch', 'check-replication', 'fire-signal', 'get-remote-handlers', 'inspect-remote-connections'].includes(n)) category = 'network';
            else if (['find-instances', 'walk-tree', 'get-services', 'get-instances-by-class', 'resolve-path', 'get-siblings', 'find-by-attribute', 'find-by-tag', 'get-children', 'scan-nil-instances', 'find-by-property', 'scan-proximity', 'get-instances-by-subclass', 'get-instance', 'compare-instances', 'get-workspace-objects'].includes(n)) category = 'inspection';
            else if (['get-player', 'get-players', 'get-local-player', 'dump-workspace-players', 'get-humanoid-state', 'set-player', 'modify-local-player', 'teleport', 'teleport-player', 'bypass-anticheat', 'disable-anticheat', 'send-chat'].includes(n)) category = 'player';
            else if (['get-gui-tree', 'dump-gui', 'dump-gui-hierarchy', 'get-screen-text', 'extract-screen-text', 'inject-gui', 'manage-esp', 'watch-ui-changes', 'world-to-screen', 'get-geometry', 'track-cursor', 'hide-notifications', 'click-button', 'click-ui-element'].includes(n)) category = 'gui';
            else if (['move-character', 'move-mouse', 'click-mouse', 'hold-mouse', 'hold-mouse-button', 'scroll-mouse', 'press-key', 'hold-key', 'type-text', 'control-camera', 'simulate-touch', 'fire-click-detector', 'fire-proximity-prompt', 'interact-prompts'].includes(n)) category = 'input';
            else if (['execute-script', 'execute-file', 'get-script', 'get-script-source', 'decompile-script', 'get-loaded-modules', 'get-running-scripts', 'get-script-closure', 'get-script-hash', 'get-calling-script', 'get-script-env', 'get-roblox-env', 'analyze-sandbox', 'check-unc'].includes(n)) category = 'scripting';
            else if (['inspect-metatable', 'modify-metatable', 'set-raw-metatable', 'toggle-readonly', 'hook-function', 'check-closure-type', 'scan-registry', 'scan-gc', 'inspect-closure', 'get-constants-upvalues', 'get-debug-info', 'get-hidden-property', 'set-hidden-property', 'set-scriptable'].includes(n)) category = 'memory';
            else if (['read-file', 'write-file', 'delete-file', 'list-files', 'create-folder', 'load-custom-asset'].includes(n)) category = 'filesystem';
            else if (['create-instance', 'destroy-instance', 'clone-instance', 'read-properties', 'set-properties', 'inspect-property'].includes(n)) category = 'instances';
            else if (['list-roblox-processes', 'launch-roblox', 'open-roblox-game', 'take-screenshot', 'record-roblox-video', 'get-roblox-versions', 'get-transport-status', 'set-transport-mode', 'set-autoexecute', 'get-metadata', 'get-console-logs'].includes(n)) category = 'server';

            return { ...t, category };
        });

        res.json({ total: allTools.length, tools: categorized });
    });

    app.get('/api/sessions', (_req: Request, res: Response): void => {
        const active = sessions.listActive ? sessions.listActive() : [];
        const all = sessions.listAll ? sessions.listAll() : active;
        res.json({
            activeCount: sessions.activeCount,
            sessions: all,
        });
    });

    app.get('/api/unc', (_req: Request, res: Response): void => {
        const active = sessions.listActive ? sessions.listActive() : [];
        const firstWithCaps = active.find((s: any) => s.capabilities && s.capabilities.supported !== undefined);
        const capabilities = firstWithCaps ? firstWithCaps.capabilities : null;

        const standardUncList = [
            { name: 'loadstring', category: 'Code Execution', fallback: 'None (Hard Requirement)', desc: 'Compile & run Luau code string' },
            { name: 'hookmetamethod', category: 'Hooking', fallback: 'hookfunction on __namecall', desc: 'Hook metamethods (__namecall, etc.)' },
            { name: 'hookfunction', category: 'Hooking', fallback: 'No-op', desc: 'Detour C / Luau closures' },
            { name: 'newcclosure', category: 'Hooking', fallback: 'Identity', desc: 'Wrap Lua function as a C closure' },
            { name: 'clonefunction', category: 'Hooking', fallback: 'Identity', desc: 'Clone a closure to bypass integrity checks' },
            { name: 'getnamecallmethod', category: 'Hooking', fallback: 'Returns empty string', desc: 'Get current namecall method in hook' },
            { name: 'setnamecallmethod', category: 'Hooking', fallback: 'No-op', desc: 'Restore namecall method before calling orig' },
            { name: 'getrawmetatable', category: 'Metatables', fallback: 'getmetatable', desc: 'Retrieve raw metatable bypassing __metatable' },
            { name: 'setrawmetatable', category: 'Metatables', fallback: 'No-op', desc: 'Overwrite raw metatable bypassing lock' },
            { name: 'setreadonly', category: 'Metatables', fallback: 'No-op', desc: 'Toggle readonly flag on tables' },
            { name: 'isreadonly', category: 'Metatables', fallback: 'Returns false', desc: 'Check if table is readonly' },
            { name: 'queue_on_teleport', category: 'Teleport', fallback: 'None (manual reinject)', desc: 'Queue Lua code to execute on place teleport' },
            { name: 'WebSocket.connect', category: 'Network', fallback: 'HTTP Stream Long-Polling', desc: 'Establish bidirectional WebSocket connection' },
            { name: 'request / http_request', category: 'Network', fallback: 'game:HttpGet / HttpService', desc: 'Perform raw HTTP requests bypassing domain checks' },
            { name: 'decompile', category: 'Decompilation', fallback: 'getscriptbytecode info', desc: 'Decompile bytecode into readable Luau' },
            { name: 'getscriptbytecode', category: 'Decompilation', fallback: 'Error reported', desc: 'Retrieve compiled Luau bytecode' },
            { name: 'cloneref', category: 'Instances', fallback: 'Identity function', desc: 'Obtain clean unforgeable instance reference' },
            { name: 'getnilinstances', category: 'Instances', fallback: 'Returns empty table', desc: 'Enumerate instances parented to nil' },
            { name: 'compareinstances', category: 'Instances', fallback: '== operator', desc: 'Compare underlying C++ pointers' },
            { name: 'gethiddenproperty', category: 'Properties', fallback: 'Returns nil', desc: 'Read hidden/non-scriptable properties' },
            { name: 'sethiddenproperty', category: 'Properties', fallback: 'No-op', desc: 'Write hidden/non-scriptable properties' },
            { name: 'setscriptable', category: 'Properties', fallback: 'No-op', desc: 'Make hidden property visible to scripts' },
            { name: 'gethui', category: 'GUI', fallback: 'CoreGui / PlayerGui', desc: 'Get hidden UI container for drawing overlays' },
            { name: 'firesignal', category: 'GUI', fallback: 'signal:Fire()', desc: 'Fire instance events (MouseButton1Click, etc.)' },
            { name: 'fireclickdetector', category: 'Interaction', fallback: 'No-op', desc: 'Trigger ClickDetector without clicking' },
            { name: 'fireproximityprompt', category: 'Interaction', fallback: 'No-op', desc: 'Trigger ProximityPrompt ignoring duration' },
            { name: 'getconnections', category: 'Connections', fallback: 'instance:GetConnections()', desc: 'Enumerate RBXScriptConnection handlers' },
            { name: 'readfile', category: 'Filesystem', fallback: 'Returns empty string', desc: 'Read file from executor workspace' },
            { name: 'writefile', category: 'Filesystem', fallback: 'No-op', desc: 'Write file to executor workspace' },
            { name: 'deletefile', category: 'Filesystem', fallback: 'No-op', desc: 'Delete file from executor workspace' },
            { name: 'listfiles', category: 'Filesystem', fallback: 'Returns empty table', desc: 'List files in workspace folder' },
            { name: 'makefolder', category: 'Filesystem', fallback: 'No-op', desc: 'Create directory in workspace' },
            { name: 'getcustomasset', category: 'Filesystem', fallback: 'Error reported', desc: 'Create rbxasset:// URL from workspace file' },
            { name: 'getgc', category: 'Memory & GC', fallback: 'Error reported', desc: 'Enumerate all objects in Lua GC' },
            { name: 'getreg', category: 'Memory & GC', fallback: 'Error reported', desc: 'Access Lua registry table' },
            { name: 'getrenv', category: 'Environment', fallback: 'Error reported', desc: 'Inspect global Roblox game environment' },
            { name: 'getgenv', category: 'Environment', fallback: '_G', desc: 'Access executor global environment' },
            { name: 'identifyexecutor', category: 'Environment', fallback: 'Returns Unknown', desc: 'Identify executor brand and version' },
        ];

        res.json({
            capabilities,
            standardFunctions: standardUncList,
        });
    });

    app.get('/api/processes', (_req: Request, res: Response): void => {
        const procs = processManager.listRobloxProcesses();
        const active = sessions.listActive ? sessions.listActive() : [];
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
                ...p,
                isConnected,
                status: isConnected ? ('connected' as const) : ('unconnected' as const),
                workerId: sess ? sess.workerId : null,
                transport: sess ? (sess.transport || 'ws') : null,
                sessionName: sess ? sess.name : null,
            };
        });
        res.json({
            processes: enriched,
            total: procs.length,
            status: {
                connected: connectedCount,
                unconnected: unconnectedCount,
            },
            connectedCount,
            unconnectedCount,
        });
    });

    app.post('/api/processes/launch', (_req: Request, res: Response): void => {
        const result = processManager.launchRoblox();
        res.json(result);
    });

    app.post('/api/tools/execute', async (req: Request, res: Response): Promise<void> => {
        const { name, arguments: args } = req.body || {};
        if (!name) {
            res.status(400).json({ success: false, error: 'name is required' });
            return;
        }
        try {
            const mcpReq = { jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args || {} } };
            const mcpRes = await mcp.handleMessage(mcpReq);
            res.json(mcpRes);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    app.get('/health', (_req: Request, res: Response): void => {
        const procs = processManager.listRobloxProcesses();
        const active = sessions.listActive ? sessions.listActive() : [];
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

        res.json({
            status: 'ok',
            uptime: process.uptime(),
            port: parseInt(process.env.MCP_PORT!, 10) || 28429,
            ...queue.getStats(),
            toolsRegistered: tools.count,
            wsConnections: wss.connectedCount,
            activeSessions: sessions.activeCount,
            robloxProcesses: {
                total: procs.length,
                status: {
                    connected: connectedCount,
                    unconnected: unconnectedCount,
                },
                list: enriched,
            },
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
