/**
 * mcp-server.ts — Official MCP SDK wrapper
 *
 * Uses @modelcontextprotocol/sdk for proper MCP compliance.
 * Handles ESM/CJS interop via absolute path.
 */
const path = require('path');
const SDK_DIR = path.resolve(__dirname, '..', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs');

function loadSdk() {
  const Server = require(path.join(SDK_DIR, 'server', 'index.js')).Server;
  const StdioServerTransport = require(path.join(SDK_DIR, 'server', 'stdio.js')).StdioServerTransport;
  const types = require(path.join(SDK_DIR, 'types.js'));
  return {
    Server, StdioServerTransport,
    ListToolsRequestSchema: types.ListToolsRequestSchema,
    CallToolRequestSchema: types.CallToolRequestSchema,
    ListResourcesRequestSchema: types.ListResourcesRequestSchema,
    ReadResourceRequestSchema: types.ReadResourceRequestSchema,
    ListPromptsRequestSchema: types.ListPromptsRequestSchema,
  };
}

const { Server, StdioServerTransport, ListToolsRequestSchema, CallToolRequestSchema,
        ListResourcesRequestSchema, ReadResourceRequestSchema, ListPromptsRequestSchema } = loadSdk();

function initMcpServer(queue: any, tools: any, sessions: any, proc: any) {
  const server = new Server(
    { name: 'roblox-mcp-difz', version: '1.0.0' },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.getTools() }));

  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    const { name, arguments: args } = request.params;
    if (!tools.getTool(name)) throw new Error(`Unknown tool: ${name}`);
    try {
      if (SERVER_SIDE_TOOLS.has(name)) {
        return { content: [{ type: 'text', text: JSON.stringify(runServerTool(name, args || {}, proc, sessions), null, 2) }] };
      }
      const workerId = args?.pid ? String(args.pid) : undefined;
      const result = await queue.submitTask(name, args || {}, { workerId });
      return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }) }], isError: true };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      { uri: 'mcp://roblox/game/metadata', name: 'Game Metadata', description: 'Current game session metadata', mimeType: 'application/json' },
      { uri: 'mcp://roblox/game/players', name: 'Active Players', description: 'Real-time player data', mimeType: 'application/json' },
      { uri: 'mcp://roblox/game/remotes', name: 'Remote Events & Functions', description: 'All detected remotes', mimeType: 'application/json' },
      { uri: 'mcp://roblox/game/workspace', name: 'Workspace Objects', description: '3D object tree', mimeType: 'application/json' },
      { uri: 'mcp://roblox/game/console', name: 'Console Logs', description: 'Recent LogService output', mimeType: 'application/json' },
    ],
  }));

  const RESOURCE_MAP: Record<string, string> = {
    'mcp://roblox/game/metadata': 'get_game_metadata',
    'mcp://roblox/game/players': 'dump_workspace_players',
    'mcp://roblox/game/remotes': 'dump_remote_events',
    'mcp://roblox/game/workspace': 'get_workspace_objects',
    'mcp://roblox/game/console': 'get_console_logs',
  };

  server.setRequestHandler(ReadResourceRequestSchema, async (request: any) => {
    const uri: string = request.params.uri;
    const toolName: string | undefined = RESOURCE_MAP[uri];
    if (!toolName) throw new Error(`Unknown resource: ${uri}`);
    const result = await queue.submitTask(toolName, {});
    return { contents: [{ uri, mimeType: 'application/json', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      { name: 'analyze_game', description: 'Dumps game metadata, remotes, and player data in one shot.', arguments: [] },
      { name: 'find_exploit_vector', description: 'Scan remotes and workspace to find exploit entry points.', arguments: [] },
    ],
  }));

  return server;
}

const SERVER_SIDE_TOOLS = new Set(['get_roblox_processes', 'launch_roblox', 'open_game', 'capture_roblox_screenshot', 'get_roblox_versions']);

function runServerTool(name: string, args: any, proc: any, sessions: any): any {
  switch (name) {
    case 'get_roblox_processes': return { success: true, processes: proc.listRobloxProcesses(), count: sessions.activeCount };
    case 'launch_roblox': return proc.launchRoblox(args?.path || null);
    case 'open_game': return proc.openGame(args?.place_id, args || {});
    case 'capture_roblox_screenshot': {
        const ss = proc.performScreenshot(args?.pid ? Number(args.pid) : undefined);
        if (ss.error) return { success: false, error: ss.error };
        if (ss.needsDisambiguation) return { success: true, needsDisambiguation: true, windows: ss.windows };
        return { success: true, image: 'data:image/png;base64,' + ss.imageBase64, pid: args?.pid || null };
    }
    case 'get_roblox_versions': return getRobloxVersions();
    default: return { success: false, error: `Unknown: ${name}` };
  }
}

function getRobloxVersions() {
  const fs = require('fs'); const p = require('path');
  const v: any[] = [];
  const dirs = [
    process.env.LOCALAPPDATA ? p.join(process.env.LOCALAPPDATA, 'Roblox', 'Versions') : '',
    'C:\\Program Files (x86)\\Roblox\\Versions',
    'C:\\Program Files\\Roblox\\Versions',
  ];
  for (const d of dirs) {
    if (!d || !fs.existsSync(d)) continue;
    try {
      for (const ver of fs.readdirSync(d).filter((x: string) => x.startsWith('version-')).sort().reverse()) {
        v.push({
          version: ver.replace('version-', ''),
          path: d + '/' + ver,
          hasPlayerLauncher: fs.existsSync(p.join(d, ver, 'RobloxPlayerLauncher.exe')),
          hasPlayerBeta: fs.existsSync(p.join(d, ver, 'RobloxPlayerBeta.exe')),
        });
      }
    } catch (e: any) { console.error('[MCP] getRobloxVersions error:', e?.message || e); }
  }
  return { success: true, versions: v };
}

module.exports = { initMcpServer, Server, StdioServerTransport };
