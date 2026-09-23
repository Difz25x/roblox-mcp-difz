# roblox-mcp-difz

[![npm version](https://img.shields.io/npm/v/roblox-mcp-difz.svg?style=flat-square&color=00f0ff)](https://www.npmjs.com/package/roblox-mcp-difz)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg?style=flat-square)](LICENSE)
[![Tools](https://img.shields.io/badge/Tools-80%20Streamlined-violet.svg?style=flat-square)](#tools-overview)
[![Transport](https://img.shields.io/badge/Transport-WebSocket%20%2B%20Stream-cyan.svg?style=flat-square)](#dual-transport)

**The Universal Model Context Protocol (MCP) server for Roblox game control, reverse engineering, and multi-session automation.**

Works out-of-the-box with **Claude Code, Claude Desktop, Cursor, Windsurf, VS Code (Cline/Continue)**, or any MCP-compliant AI client. Packed with **80 streamlined tools** (and full backward-compatible legacy aliases), non-blocking remote interception, cross-game teleport persistence, and multi-instance orchestration.

---

## Quick Start (30 Seconds)

```bash
# 1. Install globally
npm install -g roblox-mcp-difz

# 2. Configure your AI client (Claude Code, Cursor, etc.)
rblx-mcp setup

# 3. Start the MCP server
rblx-mcp start

# 4. Inject loader into your Roblox executor (Real, Solara, Wave, Delta, etc.)
loadstring(game:HttpGet("http://127.0.0.1:28429/mcp.lua"))()
```

Open the **Command Deck Dashboard** in your browser at `http://localhost:28429` to monitor active clients, run interactive tool tests, and view live telemetry.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                   AI Client (Claude / Cursor)                    │
│             Calls any tool with optional worker_id/pid           │
└──────────────────────────────┬───────────────────────────────────┘
                               │ MCP JSON-RPC 2.0 (HTTP / Stdio)
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                   roblox-mcp-difz Server (:28429)                │
│                                                                  │
│  ┌─────────────────────────┐     ┌────────────────────────────┐  │
│  │ Multi-Session Router    │     │ Server Management APIs     │  │
│  │ Target PID/Worker or    │     │ /api/tools, /api/sessions  │  │
│  │ Broadcast to ALL window │     │ /api/processes, /health    │  │
│  └───────────┬─────────────┘     └────────────────────────────┘  │
│              │                                                   │
│              ├──────────────────────┐                            │
│              ▼                      ▼                            │
│     ┌─────────────────┐    ┌──────────────────┐                  │
│     │ WebSocket (/ws) │    │ HTTP Stream      │                  │
│     │ Realtime Push   │    │ Long-Poll Fallback│                 │
│     └────────┬────────┘    └────────┬─────────┘                  │
└──────────────┼──────────────────────┼────────────────────────────┘
               │                      │
               ▼                      ▼
┌──────────────────────────────────────────────────────────────────┐
│                 Roblox Game Clients (public/mcp.lua)             │
│  • Non-blocking __namecall hook with setnamecallmethod           │
│  • Teleport autoexecute via queue_on_teleport                    │
│  • Dual-transport worker (WebSocket + Stream)                    │
│  • 111 tools: DataModel, Remotes, GUI, Input, Memory, Filesystem │
└──────────────────────────────────────────────────────────────────┘
```

---

## Key Capabilities

### 1. Non-Blocking Remote Interception (`spy-remotes`)
- Transparent network pass-through: `__namecall` restores `setnamecallmethod(method)` before forwarding to engine C handlers.
- **Zero frame drops**: Argument cloning and serialization execute asynchronously in background tasks.
- Clean varargs & return handling: `RemoteFunction:InvokeServer` returns the exact server response back to the game thread without freezing.

### 2. Cross-Game Teleport Autoexecute (`set-autoexecute`)
- Automatically re-injects `mcp.lua` across world hops, matchmaking, and dimensions using `queue_on_teleport`.
- Hooks `Players.LocalPlayer.OnTeleport` and automatically re-arms in the new place.
- Toggle anytime via AI tool call (`set-autoexecute`) or web dashboard switch.

### 3. Universal Multi-Session Orchestration
Run as many simultaneous Roblox instances as you want (multi-account farming, alt control, multi-boxing).

- **Target specific instance**: Pass `worker_id` (or `pid`, `session_id`) to any tool:
  ```json
  { "name": "execute-script", "arguments": { "pid": 11360, "code": "print('hello from PID 11360')" } }
  ```
- **Automatic Multi-Session Fanout**: Omit target arguments to execute the tool across **all connected instances concurrently**. Results are returned in a table per session:
  ```json
  {
    "multi_session": true,
    "total_sessions": 2,
    "results": {
      "PlayerOne_11360": { "success": true, "pid": 11360, "result": { "health": 100 } },
      "PlayerTwo_14200": { "success": true, "pid": 14200, "result": { "health": 85 } }
    }
  }
  ```

### 4. Dual Transport (WebSocket & Stream)
Two interchangeable transport engines carry identical task/result JSON:
- **WebSocket (`ws://localhost:28429/ws`)**: Bidirectional low-latency connection for executors supporting UNC `WebSocket.connect`.
- **Stream (`http://localhost:28429/stream/*`)**: HTTP long-polling fallback for executors with non-standard sockets (e.g. **Real** `__on_message_bind`).
- **Auto-fallback**: In `auto` mode, clients attempt WebSocket and automatically switch to Stream if the connection fails.

---

## Tools Overview (80 Streamlined Tools)

Every tool accepts an optional `workerId` as its first parameter (if omitted, executes across all connected game instances). Legacy aliases are retained so all existing scripts continue functioning. Below is a categorized index:

| Category | Key Tools | Highlights |
|---|---|---|
| **Networking (6)** | `list-remotes`, `fire-remote`, `spy-remotes`, `get-remote-handlers`, `fire-signal`, `check-replication` | Non-blocking RPC surveillance, argument spoofing, remote blocking & killswitch |
| **Player & Character (7)** | `get-player`, `get-players`, `set-player`, `teleport`, `bypass-anticheat`, `send-chat`, `get-humanoid-state` | Full player state, noclip, walkspeed, CFrame teleport, anti-kick hooks |
| **DataModel & Tree (10)** | `find-instances`, `walk-tree`, `resolve-path`, `get-children`, `find-by-property`, `find-by-tag`, `find-by-attribute`, `scan-proximity`, `scan-nil-instances`, `get-services` | Instance search by ClassName, spatial radius queries, nil realm scanner |
| **Properties & Lifecycle (5)**| `read-properties`, `set-properties`, `create-instance`, `clone-instance`, `destroy-instance` | Multi-property batch read/write, instance cloning, dynamic object creation |
| **GUI & Screen (7)** | `get-gui-tree`, `get-screen-text`, `click-button`, `inject-gui`, `manage-esp`, `world-to-screen`, `hide-notifications` | OCR-like text extraction, ESP billboards, coordinate projection, GUI hierarchy |
| **Input Simulation (10)** | `move-character`, `move-mouse`, `click-mouse`, `hold-mouse`, `scroll-mouse`, `press-key`, `hold-key`, `type-text`, `control-camera`, `interact-prompts` | Hardware-like VirtualInputManager, smooth camera tweening, WASD pathing |
| **Scripting & Bytecode (8)** | `execute-script`, `get-script`, `get-loaded-modules`, `get-running-scripts`, `get-script-env`, `get-roblox-env`, `analyze-sandbox`, `check-unc` | Raw Luau execution, script decompilation, environment inspection, sandbox audit |
| **Metatables & Memory (10)** | `inspect-metatable`, `modify-metatable`, `toggle-readonly`, `hook-function`, `inspect-closure`, `get-debug-info`, `scan-gc`, `scan-registry`, `get-hidden-property`, `set-hidden-property` | Function detouring, closure upvalue/constant inspection, garbage collector scanning |
| **Filesystem & Assets (6)** | `read-file`, `write-file`, `delete-file`, `list-files`, `create-folder`, `load-custom-asset` | Executor workspace filesystem read/write, custom sound/image asset loading |
| **Server & Process (11)** | `list-roblox-processes`, `launch-roblox`, `open-roblox-game`, `take-screenshot`, `record-roblox-video`, `get-transport-status`, `set-transport-mode`, `set-autoexecute`, `get-metadata`, `get-console-logs` | Windows process matrix, HD screenshot, 30fps MP4 recording, live transport toggle |

---

## Command Line Reference

```bash
# Start server in foreground with interactive menu
rblx-mcp start

# Run server as hidden background daemon with system tray icon
rblx-mcp daemon

# Run in Stdio mode (for CLI MCP clients like Claude Code without HTTP)
rblx-mcp stdio

# Run setup wizard for AI platform configuration
rblx-mcp setup

# Stop running background server
rblx-mcp stop

# Check for latest updates
rblx-mcp update
```

### Environment Variables
- `MCP_PORT`: HTTP/WebSocket server port (default: `28429`).
- `MCP_TRANSPORT`: Initial transport mode (`auto`, `ws`, `stream`). Default: `auto`.
- `MCP_HOST`: Custom bind address (default: `127.0.0.1`).

---

## Server Management Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/` | GET | **Command Deck Dashboard** (Obsidian Cybernetic Web UI) |
| `/mcp` | POST | JSON-RPC 2.0 endpoint for MCP clients |
| `/mcp.lua` | GET | Raw client script for executor `loadstring` injection |
| `/health` | GET | System uptime, process status table (`connected` vs `unconnected`), queue metrics |
| `/api/tools` | GET | Complete catalog of 111 tools with schemas and category tags |
| `/api/sessions` | GET | Active worker sessions with latency, player names, and place titles |
| `/api/processes` | GET | Process list with connected status table (`connected` vs `unconnected`) |
| `/api/transport` | GET/POST | Query or switch transport mode (`auto` / `ws` / `stream`) |
| `/api/autoexecute`| GET/POST | Query or toggle teleport autoexecute state |
| `/api/unc` | GET | 38-function UNC capability breakdown |
| `/api/tools/execute`| POST | Execute tool call directly via HTTP JSON |

---

## License

MIT © [Difz25x](https://github.com/Difz25x)
