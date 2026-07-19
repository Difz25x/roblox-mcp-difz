

const path = require('path');
const SDK_DIR = path.resolve(__dirname, '..', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs');

function loadSdk() {
  try {
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
      GetPromptRequestSchema: types.GetPromptRequestSchema,
    };
  } catch (err) {
    throw new Error('@modelcontextprotocol/sdk is not installed or path is incorrect. Please run: npm install');
  }
}

const { Server, StdioServerTransport, ListToolsRequestSchema, CallToolRequestSchema,
        ListResourcesRequestSchema, ReadResourceRequestSchema, ListPromptsRequestSchema,
        GetPromptRequestSchema } = loadSdk();

const SERVER_SIDE_TOOLS = new Set(['get_roblox_processes', 'launch_roblox', 'open_game', 'capture_roblox_screenshot', 'get_roblox_versions']);

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
        const sr = await runServerTool(name, args || {}, proc, sessions);
        return { content: [{ type: 'text', text: JSON.stringify(sr, null, 2) }] };
      }

      if (name === "luau_code_executor" && args.file) {
          const fs = require("fs");
          try {
              args.code = fs.readFileSync(args.file, "utf-8");
          } catch (e: any) {
              throw new Error(`Failed to read file ${args.file}: ${e.message}`);
          }
      }

      const workerId = args?.pid ? String(args.pid) : undefined;
      const opts: any = { workerId };
      if (args && (args.timeout_ms !== undefined || args.timeout !== undefined)) {
          opts.timeoutMs = Number(args.timeout_ms ?? args.timeout);
      }
      const result = await queue.submitTask(name, args || {}, opts);
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
    try {
        const uri: string = request.params.uri;
        const toolName: string | undefined = RESOURCE_MAP[uri];
        if (!toolName) throw new Error(`Unknown resource: ${uri}`);
        const result = await queue.submitTask(toolName, {});
        return { contents: [{ uri, mimeType: 'application/json', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] };
    } catch (err) {
        throw new Error(`ReadResource error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      { name: 'analyze_game', description: 'Dumps game metadata, remotes, and player data in one shot.', arguments: [] },
      { name: 'find_vulnerability_vector', description: 'Scan remotes and workspace to find vulnerability entry points.', arguments: [] },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request: any) => {
    const name = request.params.name;
    if (name === 'analyze_game') {
      return {
        description: 'Dumps game metadata, remotes, and player data in one shot.',
        messages: [
          { role: 'user', content: { type: 'text', text: 'Call the tools: get_game_metadata, dump_workspace_players, and dump_remote_events. Synthesize a report on the current game state and active players.' } }
        ]
      };
    }
    if (name === 'find_vulnerability_vector') {
      return {
        description: 'Scan remotes and workspace to find vulnerability entry points.',
        messages: [
          { role: 'user', content: { type: 'text', text: 'First call dump_remote_events. Review the names and paths of the remotes. Identify any that look like they handle sensitive actions (e.g. AddMoney, Ban, Admin, GiveItem). Then call get_workspace_objects with class_filter="Script" to find any exposed client scripts that might interact with these remotes.' } }
        ]
      };
    }
    throw new Error(`Unknown prompt: ${name}`);
  });

  return server;
}

async function runServerTool(name: string, args: any, proc: any, sessions: any): Promise<any> {
  switch (name) {
    case 'get_roblox_processes': return { success: true, processes: proc.listRobloxProcesses(), count: sessions.activeCount };
    case 'launch_roblox': return proc.launchRoblox(args?.path || null);
    case 'open_game': {
        if (!args?.place_id) return { success: false, error: "place_id is required" };
        return proc.openGame(args.place_id, args || {});
    }
    case 'capture_roblox_screenshot': {
        const ss = await proc.performScreenshot(args?.pid ? Number(args.pid) : undefined);
        if (ss.error) return { success: false, error: ss.error };
        if (ss.needsDisambiguation) return { success: true, needsDisambiguation: true, windows: ss.windows };
        return { success: true, image: 'data:image/png;base64,' + ss.imageBase64, pid: ss.pid ?? args?.pid ?? null };
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
  let errors = [];
  for (const d of dirs) {
    if (!d || !fs.existsSync(d)) continue;
    try {
      for (const ver of fs.readdirSync(d).filter((x: string) => x.startsWith('version-')).sort().reverse()) {
        v.push({
          version: ver.replace('version-', ''),
          path: p.join(d, ver),
          hasPlayerLauncher: fs.existsSync(p.join(d, ver, 'RobloxPlayerLauncher.exe')),
          hasPlayerBeta: fs.existsSync(p.join(d, ver, 'RobloxPlayerBeta.exe')),
        });
      }
    } catch (e: any) {
        console.error('[MCP] getRobloxVersions error:', e?.message || e);
        errors.push(e?.message || String(e));
    }
  }
  return { success: true, versions: v, errors: errors.length > 0 ? errors : undefined };
}

module.exports = { initMcpServer, Server, StdioServerTransport };
