# roblox-mcp-difz

**A bridge between AI agents and Roblox.** I built this MCP (Model Context Protocol) server so your AI can directly control Roblox, reverse engineer games, intercept networks, simulate inputs, and mess with the game state.

It works with **any MCP-compatible AI client** like Claude Code, Cursor, Windsurf, or whatever else you use. 

I packed it with 150+ tools. It can traverse the DataModel, inspect properties, fire remotes, run raw Lua, hook functions, intercept network traffic, and simulate user input. Basically, if you can do it in an executor, the AI can do it now.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [Executor Setup](#executor-setup)
- [MCP Client Configuration](#mcp-client-configuration)
- [Commands](#commands)
- [UNC Compatibility (Executor Support)](#unc-compatibility-executor-support)
- [Tools (106 tools in total)](#tools-106-tools-in-total)
- [How It Actually Works](#how-it-actually-works)
- [Multi-Instance Support](#multi-instance-support)
- [When Things Break (Troubleshooting)](#when-things-break-troubleshooting)
- [Environment Variables](#environment-variables)
- [Programmatic API](#programmatic-api)
- [License](#license)

---

## Quick Start

```bash
# 1. Install
npm install -g roblox-mcp-difz

# 2. Configure AI platform (Claude Code, Cursor, etc.)
rblx-mcp setup

# 3. Start the server
rblx-mcp start

# 4. Inject into Roblox (paste into executor)
loadstring(game:HttpGet("http://127.0.0.1:28429/mcp.lua"))()
```

---

## Installation

### Global install (recommended)

```bash
npm install -g roblox-mcp-difz
```

This installs two CLI aliases: `rblx-mcp` and `roblox-mcp-difz`.

### Run without installing

```bash
npx roblox-mcp-difz
```

### Install from source

```bash
git clone https://github.com/Difz25x/roblox-mcp-difz.git
cd roblox-mcp-difz
npm install
npm run build
npm start
```

### Requirements

- **Node.js** >= 16.0.0
- **Windows** (for Roblox process management; the MCP server itself can run on any platform)
- A **Roblox executor** that supports UNC (Universal Compatibility) functions (e.g., Synapse, Script-Ware, Krnl, or any executor with WebSocket and loadstring support)

---

## Executor Setup

### 1. Start the server

```bash
rblx-mcp start
```

The server prints a banner with the HTTP and WebSocket URLs.

### 2. Inject the client script

In your Roblox executor, run:

```lua
loadstring(game:HttpGet("http://127.0.0.1:28429/mcp.lua"))()
```

You can also fetch `/mcp.luau` (same content) if your executor prefers that extension.

### 3. Verify connection

The server logs the registration with the game name, place ID, and job ID. Use the `check_unc_capabilities` tool to verify which UNC functions your executor supports.

### getgenv() Configuration

Override defaults by setting these before loading `mcp.lua`:

```lua
getgenv().MCP_HOST = "127.0.0.1"       -- default: 127.0.0.1
getgenv().MCP_PORT = 28429              -- default: 28429
getgenv().MCP_TRANSPORT = "auto"        -- "auto" | "ws" | "http"
getgenv().MCP_WORKER_ID = "my-worker"   -- unique ID for multi-instance
```

---

## MCP Client Configuration

The server exposes the standard MCP protocol via HTTP POST at `/mcp`. Configure your AI client to use the URL `http://localhost:28429/mcp`.

### Claude Code

**Automatic:**
```bash
rblx-mcp setup --ai claude-code
```

**Manual (JSON — ~/.mcp.json):**
```json
{
  "mcpServers": {
    "roblox-mcp-difz": {
      "type": "http",
      "url": "http://localhost:28429/mcp"
    }
  }
}
```

Or use the CLI:
```bash
claude mcp add roblox-mcp-difz -s user --transport http http://localhost:28429/mcp
```

### Claude Desktop

**Automatic:**
```bash
rblx-mcp setup --ai claude-desktop
```

**Manual (JSON — ~/AppData/Roaming/Claude/claude_desktop_config.json):**
```json
{
  "mcpServers": {
    "roblox-mcp-difz": {
      "type": "http",
      "url": "http://localhost:28429/mcp"
    }
  }
}
```

### Cursor

**Automatic:**
```bash
rblx-mcp setup --ai cursor
```

**Manual (JSON — ~/.cursor/mcp.json):**
```json
{
  "mcpServers": {
    "roblox-mcp-difz": {
      "type": "http",
      "url": "http://localhost:28429/mcp"
    }
  }
}
```

### Windsurf

**Automatic:**
```bash
rblx-mcp setup --ai windsurf
```

**Manual (JSON — ~/.windsurf/mcp_config.json):**
```json
{
  "mcpServers": {
    "roblox-mcp-difz": {
      "type": "http",
      "url": "http://localhost:28429/mcp"
    }
  }
}
```

### VS Code (Cline / Continue.dev)

**Automatic:**
```bash
rblx-mcp setup --ai vscode
```

**Manual (JSON — ~/.vscode/mcp.json):**
```json
{
  "mcpServers": {
    "roblox-mcp-difz": {
      "type": "http",
      "url": "http://localhost:28429/mcp"
    }
  }
}
```

---

## Commands

| Command | Description |
|---------|-------------|
| `rblx-mcp` / `rblx-mcp --help` | Show help |
| `rblx-mcp start` | Start HTTP + WebSocket server (port 28429) |
| `rblx-mcp setup` | Interactive setup wizard — configures AI platforms |
| `rblx-mcp setup --ai <name>` | Quick setup for a specific AI |
| `rblx-mcp setup --ai-list` | List supported AI platforms |

### Endpoints

| Endpoint | Transport | Purpose |
|----------|-----------|---------|
| `POST /` | HTTP | MCP JSON-RPC 2.0 |
| `POST /mcp` | HTTP | MCP JSON-RPC 2.0 (alias) |
| `GET /mcp.lua` | HTTP | Executor client script |
| `GET /mcp.luau` | HTTP | Executor client script (alias) |
| `GET /type` | HTTP | Server info JSON |
| `GET /health` | HTTP | Health check |
| `WS /ws` | WebSocket | Executor communication |

---

## UNC Compatibility (Executor Support)

The client script (mcp.lua) uses **Universal Compatibility (UNC)** functions to communicate with the Roblox executor and interact with the game. Not all executors support every function. The table below lists every UNC function required, which tools depend on it, and whether a fallback exists.

**37 unique UNC functions** are used across the tool set.

| UNC Function | Category | Dependent Tools | Fallback |
|---|---|---|---|
| `getnilinstances` | Instance Tree Traversal | `nil_realm_scanner`, `get_nil_instances` | Returns empty array |
| `getconnections` | Remote E&F | `remote_connection_inspector`, `get_remote_connections` | `instance:GetConnections()` |
| `loadstring` | Code Execution, Script Analysis, Closure Analysis, Function Hooking | `luau_code_executor`, `execute_custom_luau`, `script_decompiler`, `closure_inspector`, `closure_upvalue_editor`, `function_interceptor_installer`, `function_hook_installer` | None (core requirement) |
| `gethiddenproperty` | Hidden Properties | `hidden_property_reader` | Returns nil |
| `sethiddenproperty` | Hidden Properties | `hidden_property_writer` | No-op |
| `setscriptable` | Hidden Properties | `property_scriptable_toggler` | No-op |
| `gethui` | GUI Manipulation | `gui_hierarchy_dumper`, `screen_text_extractor`, `notification_hider`, `clean_gui_traces`, `gui_button_clicker` | Returns CoreGui |
| `firesignal` | GUI Manipulation, Instance Lifecycle | `gui_button_clicker`, `signal_replicator` | `signal:Fire()` |
| `readfile` | File System | `file_reader` | Returns empty string |
| `writefile` | File System | `file_writer` | No-op |
| `delfile` | File System | `file_deleter` | No-op |
| `listfiles` | File System | `file_lister` | No-op |
| `isfile` | File System | `file_lister` | Returns false |
| `makefolder` | File System | `folder_creator` | No-op |
| `getcustomasset` | File System | `custom_asset_loader` | Fails with error |
| `getloadedmodules` | Script & Module Analysis | `get_loaded_modules`, `module_registry_scanner` | Error reported |
| `getrunningscripts` | Script & Module Analysis | `running_scripts_lister` | Error reported |
| `getscriptbytecode` | Script & Module Analysis | `script_source_ripper`, `script_decompiler`, `bytecode_disassembler` | Error reported |
| `getscriptclosure` | Script & Module Analysis, Closure Analysis | `script_closure_getter`, `closure_type_checker` | Error reported |
| `getscripthash` | Script & Module Analysis | `script_hash_calculator` | Error reported |
| `getcallingscript` | Script & Module Analysis | `calling_script_finder` | Error reported |
| `getsenv` | Script & Module Analysis | `script_environment_dumper` | Error reported |
| `getrenv` | Script & Module Analysis | `roblox_environment_viewer` | Error reported |
| `getthreadidentity` | Script & Module Analysis | `sandbox_analyzer` | Returns 0 |
| `isexecutorclosure` | Script & Module Analysis, Closure Analysis | `sandbox_analyzer`, `closure_type_checker` | Returns false |
| `getgc` | Script & Module Analysis, Registry & GC | `gc_scanner`, `sandbox_analyzer` | Error reported |
| `getreg` | Script & Module Analysis, Registry & GC | `registry_scanner`, `registry_reader`, `sandbox_analyzer` | Error reported |
| `iscclosure` | Closure Analysis | `closure_type_checker` | Error reported |
| `islclosure` | Closure Analysis | `closure_type_checker` | Error reported |
| `getrawmetatable` | Metatable Manipulation | `metatable_seer`, `metatable_modifier`, `readonly_toggler` | Falls to `getmetatable` |
| `setrawmetatable` | Metatable Manipulation | `metatable_modifier`, `raw_metatable_setter` | No-op |
| `setreadonly` | Metatable Manipulation | `readonly_toggler` | No-op |
| `isreadonly` | Metatable Manipulation | `metatable_seer`, `readonly_toggler` | Returns false |
| `hookfunction` | Function Hooking, Script Analysis, Network Traffic | `function_interceptor_installer`, `function_hook_installer`, `spy_remote_traffic`, `traffic_interceptor_installer`, `remote_blocker_installer`, `argument_spoofer`, `response_interceptor` | No-op |
| `hookmetamethod` | Function Hooking | `namecall_spy` | Error reported |
| `getnamecallmethod` | Function Hooking | `namecall_spy` | Returns empty string |
| `fireclickdetector` | Instance Lifecycle | `fire_click_detector` | No-op |
| `fireproximityprompt` | Instance Lifecycle | `fire_proximity_prompt`, `interact_all_proximity_prompts` | No-op |
| `compareinstances` | Instance Lifecycle | `instance_comparer` | Lua `==` operator |
| `cloneref` | Internal | All tools (service references) | Identity function |
| `getpid` | Internal | Multi-instance targeting | nil |

> **Note:** `loadstring` is the only hard requirement — every other UNC function has a graceful fallback. Use the `check_unc_capabilities` tool at runtime to see exactly what your executor supports.

---

## Tools (106 tools in total)

This MCP server comes with over 100 tools. Below are some of the most commonly used tools. For the complete list and detailed descriptions, refer to `src/tool-definitions.ts`.

| Tool | Description |
|------|-------------|
| `execute-script` | Executes arbitrary Luau source code in the target Roblox process with full read/write access. |
| `dump-workspace-players` | Get a list of all players along with their character models, HP, speed, and backpack contents. |
| `walk-tree` | Search for objects within the game. Can be filtered by name, object type (class), and maximum folder depth. |
| `resolve-path` | Resolve a string path like 'workspace.Model.Part' into an actual object reference. |
| `spy-remotes` | Master tool for network traffic interception, blocking, and argument spoofing. Hooks FireServer/InvokeServer. |
| `dump-remote-events` | Scans specified paths for all RemoteEvents, RemoteFunctions, and UnreliableRemoteEvents. |
| `decompile-script` | Decompiles a Script, ModuleScript, or LocalScript using the decompile chain (LuaExpert/Medal/Konstant). |
| `get-local-player` | Dump the LocalPlayer in depth: Backpack, Leaderstats, Character state, Humanoid, and PlayerGui. |
| `disable-anticheat` | Bypass client-side anticheat. Prevents Kick(), disables suspiciously named scripts, and blocks teleport bans. |
| `take-screenshot` | Capture a screenshot of a Roblox process window on Windows. Returns base64-encoded PNG data URL. |

> **Note:** There are 96 other tools covering GUI manipulation, instance cloning/destroying, camera control, mouse/keyboard simulation, metatable manipulation, closure inspection, and more!

---

## How It Actually Works

```
┌──────────────────────────────────────────────────────────────────┐
│                            AI Client                             │
│  (Claude Code / Claude Desktop / Cursor / Windsurf / Cline /     │
│   Continue.dev / any MCP-compatible client)                      │
└─────────────────────────┬────────────────────────────────────────┘
                          │ MCP JSON-RPC 2.0 (HTTP POST /mcp)
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│                   Node.js MCP Server (:28429)                    │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────┐  │
│  │ MCP Handler │  │ Queue Manager│  │ WebSocket Server (WS)   │  │
│  │ (JSON-RPC)  │──│ (Task Queue) │──│ /ws                     │  │
│  └─────────────┘  └──────────────┘  └───────────┬─────────────┘  │
│                                                 │                │
│  ┌─────────────┐  ┌──────────────┐              │                │
│  │Tool Defs    │  │Session Mgr   │              │                │
│  │(106 tools)  │  │(workers)     │              │                │
│  └─────────────┘  └──────────────┘              │                │
│                                                 │                │
│  ┌──────────────────────────────────────────────┐                │
│  │ Server-Side Tools (Process Manager)          │                │
│  │ get_roblox_processes, launch_roblox,         │                │
│  │ open_game, capture_roblox_screenshot,        │                │
│  │ get_roblox_versions                          │                │
│  └──────────────────────────────────────────────┘                │
└─────────────────────────────────────────────────┼────────────────┘
                                                  │ WebSocket
                                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Roblox Executor (mcp.lua)                     │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────┐  │
│  │ WS Client   │  │ Task Router  │  │ Handler Registry        │  │
│  │ (connect)   │──│ (wsPoll)     │──│ (106+ handlers)         │  │
│  └─────────────┘  └──────────────┘  └─────────────────────────┘  │
│                                           │                      │
│  ┌────────────────────────────────────────┘                      │
│  │  UNC Compatibility Layer                                      │
│  │  (getnilinstances, hookfunction, loadstring, getreg,          │
│  │   getgc, getconnections, firesignal, readfile, writefile,     │
│  │   gethiddenproperty, sethiddenproperty, getrawmetatable, ...) │
│  └───────────────────────────────────────────────────────────────┘
│                                                                  │
│                     Roblox DataModel                             │
│  (Players, Workspace, Lighting, ReplicatedStorage, CoreGui, ...) │
└──────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **AI Client** sends MCP JSON-RPC (tool call) via HTTP POST to `/mcp`
2. **MCP Handler** validates the tool name and dispatches it
3. **Server-side tools** (process management, screenshots) execute directly in Node.js
4. **Executor tools** are queued in the Queue Manager and sent via WebSocket to all connected Roblox executors
5. **mcp.lua** receives the task, routes it to the correct handler, which interacts with the Roblox DataModel using UNC functions
6. **Result** flows back: executor -> WebSocket -> Queue Manager -> MCP Handler -> AI Client

### Communication Protocol

**Registration** (executor -> server):
```json
{
  "type": "register",
  "worker_id": "uuid-or-custom-id",
  "username": "PlayerName",
  "userId": 123456,
  "placeId": 987654321,
  "jobId": "abc-def-ghi",
  "placeName": "Game Name",
  "capabilities": { "total": 37, "supported": 35, "missing": ["someFunc"] }
}
```

**Task** (server -> executor):
```json
{
  "type": "task",
  "id": "task-uuid",
  "tool": "execute_custom_luau",
  "args": { "code": "print('hello')" },
  "pid": 1234,
  "workerId": "target-worker"
}
```

**Result** (executor -> server):
```json
{
  "type": "result",
  "id": "task-uuid",
  "data": { "success": true, "result": "hello" },
  "error": null,
  "pid": 1234
}
```

### Multi-Instance Support

Each executor registers with a unique `worker_id`. Tools can target a specific Roblox instance by PID:

```json
{
  "name": "get_roblox_processes",
  "arguments": {}
}
// Returns [{ pid: 1234, name: "RobloxPlayerBeta", windowTitle: "Game Name" }]

{
  "name": "execute_custom_luau",
  "arguments": {
    "pid": 1234,
    "code": "print('hello from instance 1234')"
  }
}
```

If no PID is specified, tasks are broadcast to ALL connected executors. To use multi-instance with custom IDs, set `getgenv().MCP_WORKER_ID = "my-instance"` before injecting mcp.lua.

---

## UNC Compatibility Layer

The client script (mcp.lua) includes a full compatibility layer that adapts to the executor's available UNC functions. Every function has a fallback strategy:

| UNC Function | Fallback Behavior |
|---|---|
| `WebSocket.connect` | Falls back to HTTP polling transport |
| `getnilinstances` | Returns empty array |
| `fireclickdetector` | No-op |
| `fireproximityprompt` | No-op |
| `firesignal` | Uses `signal:Fire()` if available |
| `getconnections` | Uses `instance:GetConnections()` |
| `gethiddenproperty` | Returns nil |
| `sethiddenproperty` | No-op |
| `setscriptable` | No-op |
| `hookfunction` | No-op (tools that depend on it will report failure) |
| `getrawmetatable` | Falls to standard `getmetatable` |
| `setrawmetatable` | No-op |
| `setreadonly` | No-op |
| `isreadonly` | Returns false |
| `gethui` | Returns CoreGui |
| `readfile` | Returns empty string |
| `writefile`, `delfile` | No-op |
| `isfile` | Returns false |
| `makefolder` | No-op |
| `getcustomasset` | Fails with error |
| `getloadedmodules`, `getrunningscripts`, etc. | Fails with error |
| `compareinstances` | Uses Lua `==` operator |

### Decompilation Chain

The `script_decompiler` tool automatically falls through three decompile services:
1. **LuaExpert** (api.lua.expert) — primary
2. **Medal** (medal.upio.dev) — fallback 1
3. **Konstant** (api.plusgiant5.com) — fallback 2

---

## When Things Break (Troubleshooting)

### Check UNC Capabilities

Always start by checking what your executor supports:

```
Tool: check_unc_capabilities
```

This returns a complete support matrix showing which of the 37 UNC functions your executor provides, making it immediately clear which tools will work and which will report errors.

### "Attempt to call blacklisted function" Error

Some executors block certain UNC functions (especially `hookfunction`, `getgc`, `getreg`, `loadstring` with restricted environments).

**Solutions:**
1. Run `check_unc_capabilities` to identify which functions are blocked
2. Try a different `identity_level` (use identity 8 for maximum access):
   ```
   Tool: luau_code_executor
   Arguments: { "code": "...", "identity_level": 8 }
   ```
3. If your executor blocks `loadstring`, most advanced tools (code execution, hooks, closure analysis) will not work. Look for an executor with better UNC support
4. Some executors require manual enabling of certain functions in their settings

### "No Roblox executor is connected" Error

This occurs when the MCP server is running but no Roblox executor has connected via WebSocket.

**Solutions:**
1. Ensure the server is running: `rblx-mcp start`
2. Verify the server is listening: `curl http://localhost:28429/health`
3. Inject the client script in your executor:
   ```lua
   loadstring(game:HttpGet("http://127.0.0.1:28429/mcp.lua"))()
   ```
4. Check the server console for registration messages
5. Verify firewall rules aren't blocking WebSocket connections on port 28429
6. If your executor doesn't support WebSocket, set transport to HTTP:
   ```lua
   getgenv().MCP_TRANSPORT = "http"
   ```

### WebSocket Connection Issues

**Executor won't connect:**
1. Confirm the Roblox executor supports `WebSocket.connect` (check `check_unc_capabilities`)
2. Try HTTP fallback transport:
   ```lua
   getgenv().MCP_TRANSPORT = "http"
   ```
3. If using a remote server (not localhost), replace `127.0.0.1` with the server's IP:
   ```lua
   getgenv().MCP_HOST = "192.168.1.100"
   ```
4. Some executors block WebSocket to certain hosts. Try port 80 or 443 if your server supports it

**Connection drops:**
1. The server sends a heartbeat every 30 seconds
2. If you see frequent disconnects, check for network instability or anti-cheat interference
3. Use the HTTP transport fallback for more stable connections

### Tool Returns "not handled by this executor"

This means the requested tool has no handler registered in the mcp.lua script.

**Solutions:**
1. Ensure you have the latest version: `npm update -g roblox-mcp-difz`
2. Re-inject mcp.lua (it's served fresh on every HTTP GET)
3. If the tool is very new, the public/mcp.lua may need to be regenerated

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_PORT` | `28429` | HTTP server port |

### Roblox-side (getgenv) Configuration

Set these before loading mcp.lua:

| Variable | Default | Description |
|----------|---------|-------------|
| `getgenv().MCP_HOST` | `"127.0.0.1"` | Server hostname/IP |
| `getgenv().MCP_PORT` | `28429` | Server port |
| `getgenv().MCP_TRANSPORT` | `"auto"` | Transport: `"auto"` | `"ws"` | `"http"` |
| `getgenv().MCP_WORKER_ID` | `auto-generated` | Unique worker ID for multi-instance |

---

## Programmatic API

```typescript
import robloxMcp from 'roblox-mcp-difz';

// Create a configured server
const { app, server, tools, wss } = robloxMcp.createApp({ verbose: true });
server.listen(28429, () => {
  console.log(`Server ready (${tools.count} tools)`);
});

// Get tool definitions
const allTools = robloxMcp.getTools();
console.log(`Total tools: ${allTools.length}`);
```

### Module exports

| Export | Type | Description |
|--------|------|-------------|
| `createApp(options?)` | Function | Creates the Express app, HTTP server, WebSocket server, and all managers |
| `getTools()` | Function | Returns the full tool definitions array |
| `McpHandler` | Class | MCP JSON-RPC message handler |
| `QueueManager` | Class | Task queue for dispatching to executors |
| `SessionManager` | Class | Manages connected executor sessions |
| `WsServer` | Class | WebSocket server for executor communication |
| `ToolDefinitions` | Class | Tool registry |

---

## Security Notes

- **The server listens on all interfaces (`0.0.0.0`) by default.** If you only need local access, consider binding to `127.0.0.1` via your firewall or a reverse proxy.
- **There is no authentication.** Anyone who can reach the server port can invoke any tool. Do not expose the server to untrusted networks.
- **Code execution tools (`luau_code_executor`, `execute_custom_luau`) provide full Lua VM access** within the Roblox process, including the ability to call any API, hook any function, and modify any instance. Use with extreme caution.
- **The server-side tools** (`get_roblox_processes`, `launch_roblox`, `open_game`, `capture_roblox_screenshot`) execute on the Node.js host machine and can launch processes or enumerate running applications.
- **Network interception tools** (`argument_spoofer`, `response_interceptor`, `remote_killswitch_toggler`) can modify or block game network traffic, potentially violating terms of service.
- **This tool is for educational and research purposes only.** Unauthorized use against games you do not own or have explicit permission to test may violate Roblox Terms of Service.

---

## License

MIT
