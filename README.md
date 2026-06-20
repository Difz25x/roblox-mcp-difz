# roblox-mcp

Universal MCP server for **Roblox game control, reverse engineering, and exploitation**.

**132 tools** across 8 categories — Instance Tree Exploration, Property Inspection, Visual Tracking, Input Simulation, Environment Manipulation, Memory Hooking, Network Traffic, State Bypass.

Works with **Claude Code, Claude Desktop, Cursor, Windsurf, VS Code (Cline/Continue)**, and any MCP-compatible AI.

## Install

```bash
npm install -g roblox-mcp
```

Or run directly without install:

```bash
npx roblox-mcp
```

## Usage

```bash
# Start HTTP server (default port 28429)
roblox-mcp start

# Start stdio MCP transport (for AI integration)
roblox-mcp start:stdio

# Interactive setup wizard — configure your AI
roblox-mcp setup

# Quick setup for a specific AI
roblox-mcp setup --ai claude-code
roblox-mcp setup --ai claude-desktop
roblox-mcp setup --ai cursor
```

## Setup Wizard

```
$ roblox-mcp setup

  Select AI platform(s) to configure:

    1. 🤖 Claude Code
    2. 💻 Claude Desktop
    3. 🔷 Cursor
    4. 🏄 Windsurf
    5. 📝 VS Code (Cline / Continue)
    6. 🔌 Generic MCP Client

  Enter numbers (comma-separated, e.g. "1,3" or "all"):
```

The wizard auto-detects config paths, creates the files, and merges with existing configs.

## API (programmatic)

```javascript
const robloxMcp = require('roblox-mcp');

// Create a configured server
const { app, queue, tools } = robloxMcp.createApp({ verbose: true });
app.listen(28429);

// Get tool list
const allTools = robloxMcp.getTools();
console.log(`Total tools: ${allTools.length}`);
```

## Endpoints (HTTP mode)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp` | POST | MCP JSON-RPC 2.0 (tools/list, tools/call, initialize, etc.) |
| `/req` | POST | Executor long-poll — fetch next queued task |
| `/res` | POST | Executor result submission |
| `/health` | GET | Server health & queue stats |
| `/mcp.luau` | GET | Luau client script |

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_PORT` | `28429` | HTTP server port |

## Luau Client

Inject `http://localhost:28429/mcp.luau` into your Roblox executor.
The client long-polls the server and dispatches tool calls to generic handlers.

## Commands

| Command | Description |
|---------|-------------|
| `roblox-mcp` | Start HTTP server |
| `roblox-mcp start` | Start HTTP server |
| `roblox-mcp start:stdio` | Start stdio MCP transport + HTTP |
| `roblox-mcp setup` | Interactive setup wizard |
| `roblox-mcp setup --ai <name>` | Setup for a specific AI |
| `roblox-mcp --help` | Show help |

## License

MIT
