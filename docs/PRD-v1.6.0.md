# PRD: Roblox MCP v1.6.0 — Enterprise Multi-Session Orchestration, Non-Blocking Remote Interception & Next-Gen Cybernetic Dashboard

## 1. Executive Summary

### 1.1 Problem Statement
1. **Remote Interception Lockup**: In `public/mcp.lua`, when `spy-remotes` or remote traffic logging is active, intercepted `RemoteEvent` and `RemoteFunction` calls frequently hang or fail to return back to the game thread. Games freeze, character movement locks up, and network calls fail because Luau namecall register state is invalidated by intermediate calls inside `__namecall`, and arguments/return values are not cleanly passed through to the original method.
2. **Missing Teleport Persistence (Autoexecute)**: When players teleport between places, dimensions, or servers in multi-place Roblox games (e.g. Blox Fruits Sea 1/2/3, Deepwoken, Dungeon Quest), `mcp.lua` execution halts, dropping the AI's connection until the user manually reinjects.
3. **Outdated & Minimal Dashboard**: The current `public/dashboard.html` is a bare 70-line static prototype without tool documentation, UNC capability visibility, process linkage (connected vs unconnected Roblox instances), or interactive controls.
4. **Single-Worker Tool Blindness**: AI clients (Claude, Cursor, Windsurf) currently have no clean mechanism to address a specific Roblox client or fan out a command across multiple Roblox sessions (multi-boxing/multi-instance farming).
5. **Limited API Surface**: Current server endpoints only expose raw numbers, missing tool metadata, active session state, and granular runtime diagnostics.

### 1.2 Proposed Solution
- **Non-Blocking Hook Architecture**: Overhaul `public/mcp.lua` remote interception: enforce `setnamecallmethod` preservation, decouple logging via non-yielding background queues, and ensure `origNamecall`/`origInvokeServer` returns exact varargs to the game thread.
- **`set-autoexecute` & Teleport Engine**: Implement persistent execution across server hops using `queue_on_teleport` and `LocalPlayer.OnTeleport` handlers, configurable via AI tool call and Dashboard switch.
- **Next-Gen Cybernetic Glassmorphic Dashboard**: Complete redesign of `dashboard.html` using high-end visual design principles (obsidian dark palette, neon cyan/violet accents, real-time telemetry graphs, live process matrix with connected badge, searchable 110+ tool catalog with interactive test runner, and UNC capability matrix).
- **Universal Multi-Session Dispatch**: Inject `worker_id` / `session_id` into all MCP tool calls. If omitted, fan out concurrently across all connected workers and return a structured dictionary `{ [worker_id]: result }`.
- **Rich Server Telemetry & Management APIs**: Expose `/api/tools`, `/api/sessions`, `/api/autoexecute`, `/api/unc`, `/api/processes`, and updated `/health`.

### 1.3 Success Criteria
- **Zero Game Lockups**: 100% of non-blocked `RemoteEvent:FireServer` and `RemoteFunction:InvokeServer` calls pass through to the game and server without frame drops or thread starvation.
- **100% Teleport Retention**: After in-game teleportation, the client reconnects to the MCP server within 5 seconds without manual re-injection.
- **Full Multi-Session Execution**: AI can execute any tool on a specific `worker_id`, or broadcast to $N$ connected game clients and receive structured responses per worker in $< 2$ seconds.
- **High-End Dashboard**: Dashboard loads in $< 100$ms, displays all 110+ tools with live parameter search, shows live connected vs unconnected Roblox processes, and provides one-click control over Autoexecute, Transport, and Process lifecycle.

---

## 2. User Experience & Functionality

### 2.1 User Personas
1. **AI Agent (Claude / Cursor / Windsurf)**: Operates autonomously, reads game state, fires remotes, inspects code, controls player character, and orchestrates actions across multiple Roblox windows simultaneously.
2. **Security Researcher / Game Reverser**: Analyzes network protocols, inspects obfuscated scripts, monitors client-server RPCs without breaking game gameplay.
3. **Multi-Account Botter / Power User**: Runs multiple Roblox clients (multi-instance), manages them through the web dashboard, monitors health, and relies on automated teleport persistence.

### 2.2 User Stories & Acceptance Criteria

#### Story 1: Transparent Remote Event & Function Interception
- **As a** reverse engineer or AI agent running `spy-remotes`,
- **I want** all outgoing remote calls to be logged and inspected without freezing the game,
- **So that** game logic, server transactions, and character controls continue functioning seamlessly.
- **Acceptance Criteria**:
  - `newNamecall` preserves `getnamecallmethod()` via `setnamecallmethod()` before calling `origNamecall`.
  - `RemoteFunction:InvokeServer` returns the exact return tuple from `origNamecall` or `origInvokeServer` back to the calling game script.
  - Serialization and logging happen asynchronously via non-blocking queues (`table.insert` + deferred worker) to eliminate main-thread stutter.
  - Spoofed arguments (via `spoof-remote-args`) properly unpack and pass modified arguments to the original function.
  - Blocked remotes return cleanly without hanging the caller (RemoteEvent returns `nil`; RemoteFunction returns fake `nil` or custom mock).

#### Story 2: Automatic Teleport Re-Execution (`set-autoexecute`)
- **As an** AI agent or user managing a long-running session,
- **I want** the client script to automatically re-inject itself whenever my player teleports to another game/place,
- **So that** I don't lose MCP connection during inter-place transitions (e.g. world hops, matchmaking, loading screens).
- **Acceptance Criteria**:
  - Tool `set-autoexecute` added to MCP server and Lua client (`enabled: boolean`).
  - Uses `queue_on_teleport` (with fallbacks to `syn.queue_on_teleport`, `fluxus.queue_on_teleport`, `queueonteleport`).
  - Automatically hooks `Players.LocalPlayer.OnTeleport`.
  - Re-inject payload dynamically embeds current `HOST` and `PORT`.
  - State persisted in `getgenv().MCP_AUTOEXECUTE` so subsequent places remember the preference.
  - Controllable directly via web dashboard button or MCP tool.

#### Story 3: Multi-Session Execution Routing
- **As an** AI agent orchestrating multiple game clients,
- **I want** to execute tools on either a specific Roblox instance or all connected instances at once,
- **So that** I can coordinate cooperative actions (e.g. Player A drops item, Player B picks it up) or broadcast batch commands.
- **Acceptance Criteria**:
  - All tools accept optional `worker_id` / `session_id` / `pid` argument.
  - If `worker_id` is supplied: only that worker executes the tool, returning its direct result.
  - If `worker_id` is omitted:
    - If 1 session active: executes on that session and returns result.
    - If $>1$ sessions active: executes concurrently on all sessions via `Promise.allSettled` and returns `{ [worker_id]: { success, pid, name, result } }`.
  - Server-side tools (screenshots, processes, videos) can target specific windows by PID.

#### Story 4: High-End Cybernetic Web Dashboard
- **As a** developer or user,
- **I want** an ultra-modern, high-aesthetic web dashboard,
- **So that** I can monitor active workers, inspect Roblox processes, browse documentation for all 110+ tools, test tools live, and toggle transport/autoexecute settings.
- **Acceptance Criteria**:
  - Styled with modern design standards (obsidian palette, cyan/violet neon glow, subtle glassmorphic backdrop, crisp typography).
  - **Live Process Matrix**: Lists all OS Roblox processes, clearly showing which are **Connected (Worker ID, Player Name, Place Name, Transport)** vs **Unconnected**. Includes Action buttons (Kill, Restart, Screenshot, Copy Inject Command).
  - **Tool Catalog & Documentation**: Interactive search & category filter for all 110+ tools, showing input schema, parameter types, descriptions, and a "Test Run" drawer to execute tool calls directly from browser.
  - **UNC Capability Explorer**: Visual grid of all 37+ UNC functions, showing support status, fallback strategy, and active executor capability profile.
  - **Live Control Bar**: Instant toggles for Transport Mode (`Auto` / `WebSocket` / `Stream`) and `Autoexecute on Teleport` (`ON` / `OFF`).

#### Story 5: Enriched Management & Telemetry APIs
- **As an** external client or dashboard front-end,
- **I want** comprehensive REST endpoints,
- **So that** all system state is accessible programmatically.
- **Acceptance Criteria**:
  - `GET /api/tools`: Returns all registered tools, descriptions, parameter schemas, and category tags.
  - `GET /api/sessions`: Returns list of all connected workers with transport type, PID, player name, place name, latency, and uptime.
  - `GET /api/processes`: Returns OS Roblox processes cross-referenced with connected worker metadata.
  - `GET /api/unc`: Returns capability matrix of connected executors.
  - `GET/POST /api/autoexecute`: Gets or sets the autoexecute state.

### 2.3 Non-Goals
- We are not writing a custom external Roblox injector (the user uses existing executors like Real, Solara, Wave, Delta).
- We are not bypassing server-side Roblox anticheat heuristics (Hyperion/Byfron at kernel level).
- We are not adding external database dependencies (everything runs in-memory and file-backed within Node.js).

---

## 3. Technical Specifications & Architecture

### 3.1 Architecture Overview
```
┌────────────────────────────────────────────────────────────────────────┐
│                        AI Client (Claude Code / Cursor)                │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / Stdio (JSON-RPC 2.0)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Roblox MCP Server (Node.js)                     │
│  ┌─────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │   MCP Tool Router       │  │       Server Core (Express)         │  │
│  │  - Single Target Worker │  │  - GET /api/tools                   │  │
│  │  - Multi-Session Fanout │  │  - GET /api/sessions                │  │
│  │  - Server Tools Runner  │  │  - GET /api/unc                     │  │
│  └────────────┬────────────┘  │  - GET/POST /api/transport          │  │
│               │               │  - GET/POST /api/autoexecute        │  │
│               ▼               │  - GET /public/dashboard.html       │  │
│  ┌─────────────────────────┐  └─────────────────────────────────────┘  │
│  │      Queue Manager      │                                           │
│  │  - Targeted task queues │                                           │
│  │  - Worker promise maps  │                                           │
│  └────────────┬────────────┘                                           │
│               ├───────────────────────────────────┐                    │
│               ▼                                   ▼                    │
│  ┌─────────────────────────┐         ┌──────────────────────────────┐  │
│  │   WebSocket Server      │         │   Stream Server (HTTP Poll)  │  │
│  │   (ws://localhost/ws)   │         │   (/stream/poll, /result)    │  │
│  └────────────┬────────────┘         └──────────────┬───────────────┘  │
└───────────────┼─────────────────────────────────────┼──────────────────┘
                │                                     │
                ▼                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     Roblox Client / Executor (mcp.lua)                 │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Transport Engine: WebSocket (Real-compatible) + HTTP Stream     │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │  Hook Engine: Non-blocking __namecall + setnamecallmethod        │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │  Autoexecute Engine: queue_on_teleport + OnTeleport hook         │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │  110+ Tool Dispatcher & UNC Reflection Engine                    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Hooking `__namecall` causes crash if executor hook implementation is non-standard | High | Only hook `__namecall` if `hookmetamethod` is available; fallback to method hook if not; always use `setnamecallmethod` inside hook. |
| `queue_on_teleport` not supported by executor | Medium | Graceful fallback probe across `queue_on_teleport`, `syn.queue_on_teleport`, `fluxus.queue_on_teleport`; report status to tool caller. |
| Multi-session fanout times out on one lagging client | Medium | Use `Promise.allSettled` with individual task timeouts so fast clients return immediately while dead clients report timeout without blocking others. |
| Dashboard slows down with 110+ tools | Low | Virtualized DOM / efficient client-side filtering, zero heavy front-end build steps (vanilla ES6 + CSS variables, zero runtime dependencies). |

---

## 5. Roadmap & Rollout Phases
- **Phase 1: Lua Hook Engine & Autoexecute Fixes** (Fix remote event lockup, add `set-autoexecute`, implement `queue_on_teleport`).
- **Phase 2: Server Multi-Session Orchestration & APIs** (Update `mcp-handler.ts`, `queue-manager.ts`, `ws-server.ts`, create `/api/*` endpoints).
- **Phase 3: Next-Gen Cybernetic Dashboard** (Complete rewrite of `public/dashboard.html` with tools explorer, connected process matrix, UNC inspector, live controls).
- **Phase 4: Tool Definitions & Verification** (Add `set-autoexecute` schema, inject `worker_id` across tools, run automated test suites).
