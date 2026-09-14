# Dual Transport (WebSocket & Stream) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement dual communication transports (WebSocket + HTTP Stream/Long-Polling) for Roblox MCP, add transport query/toggle endpoints, provide AI tools to inspect and change transport modes, and fix Real executor WebSocket event binding.

**Architecture:** The server manages a configurable transport mode (`auto` | `ws` | `stream`). In Stream mode, Roblox executors that cannot sustain WebSocket connections (or lack standard UNC WebSocket events) communicate via HTTP endpoints (`/stream/poll` and `/stream/result`) backed by `QueueManager.waitForTask`. The executor queries `/api/transport` at startup to determine the transport to use, with automatic fallback from WebSocket to Stream. AI clients get dedicated server-side tools (`get-transport-status` and `set-transport-mode`) to monitor and control active transports.

**Tech Stack:** Node.js (Express, ws), TypeScript, Luau (Roblox executor UNC API).

## Global Constraints
- Zero breaking changes to existing 108 MCP tools.
- Strict Luau type safety: zero `pcall` generic mismatches, zero raw `G.MCP_*` accesses, zero unhandled optional metatables.
- `public/mcp.lua` must parse cleanly under `luaparse` with Lua 5.1 syntax compatibility.
- All server-side tools run in `mcp-handler.ts` and `mcp-server.ts` without executor round-trips.

---

### Task 1: Server-Side Transport Endpoints & State Management

**Files:**
- Modify: `src/server-core.ts:40-190`
- Modify: `src/session-manager.ts:5-75`

**Interfaces:**
- Consumes: `QueueManager.waitForTask(timeoutMs, workerId)`, `QueueManager.resolveTask(id, data, error)`, `SessionManager.register(workerId, info)`
- Produces: `GET /api/transport`, `POST /api/transport`, `POST /stream/register`, `GET /stream/poll`, `POST /stream/result`, `POST /stream/ping`

- [ ] **Step 1: Extend SessionInfo in `src/session-manager.ts` to track transport type**

Add `transport?: 'ws' | 'stream'` to `SessionInfo` and `RegisterInfo` interfaces in `src/session-manager.ts`.

```typescript
export interface SessionInfo {
    workerId: string;
    pid?: string | number;
    name?: string;
    firstSeen: number;
    lastSeen: number;
    status: string;
    transport?: 'ws' | 'stream';
    capabilities?: Record<string, any>;
}

export interface RegisterInfo {
    pid?: string | number;
    name?: string;
    transport?: 'ws' | 'stream';
    capabilities?: Record<string, any>;
}
```

- [ ] **Step 2: Add Stream & Transport endpoints in `src/server-core.ts`**

In `src/server-core.ts`, track `transportMode` (`'auto' | 'ws' | 'stream'`, defaulting to `process.env.MCP_TRANSPORT || 'auto'`).
Add endpoints:
1. `GET /api/transport`:
```json
{
  "mode": "auto",
  "active_transport": "ws",
  "ws_url": "ws://localhost:28429/ws",
  "stream_urls": {
    "register": "http://localhost:28429/stream/register",
    "poll": "http://localhost:28429/stream/poll",
    "result": "http://localhost:28429/stream/result",
    "ping": "http://localhost:28429/stream/ping"
  },
  "ws_clients": 0,
  "stream_workers": 0,
  "active_sessions": 0
}
```
2. `POST /api/transport`:
Body: `{ "mode": "auto" | "ws" | "stream" }`. Sets `transportMode` and returns updated state.
3. `POST /stream/register`:
Body: `{ worker_id, username, pid, placeId, jobId, placeName, capabilities }`. Registers session in `sessions` with `transport: 'stream'`.
4. `GET /stream/poll` & `POST /stream/poll`:
Query/Body: `worker_id`, `timeout`. Calls `queue.waitForTask(timeoutMs, workerId)`. If task returned, responds `{ success: true, task }`. If timeout, responds `{ success: true, task: null, status: "timeout" }`.
5. `POST /stream/result`:
Body: `{ id, data, error, worker_id, pid }`. Calls `queue.resolveTask(id, data, error)`. Updates session `lastSeen`. Responds `{ success: true }`.
6. `POST /stream/ping`:
Body: `{ worker_id }`. Touches session `lastSeen`. Responds `{ success: true, timestamp: Date.now() }`.

- [ ] **Step 3: Run TypeScript compile to verify**

Run: `npx tsc --noEmit`
Expected: EXIT=0

---

### Task 2: AI Tools for Transport Introspection & Control

**Files:**
- Modify: `src/tool-definitions.ts`
- Modify: `src/mcp-handler.ts`
- Modify: `src/mcp-server.ts`

**Interfaces:**
- Produces: Tools `get-transport-status` and `set-transport-mode`
- Consumes: Server transport state from `server-core.ts`

- [ ] **Step 1: Add Tool Definitions in `src/tool-definitions.ts`**

Add `get-transport-status`:
```typescript
{
    name: "get-transport-status",
    description: "Get the current communication transport status between AI server and Roblox executors (WebSocket vs HTTP Stream), active mode, connected workers, and endpoints.",
    inputSchema: {
        "type": "object",
        "properties": {},
        "required": []
    }
},
{
    name: "set-transport-mode",
    description: "Switch the communication transport mode between AI server and Roblox executors ('auto', 'ws', 'stream').",
    inputSchema: {
        "type": "object",
        "properties": {
            "mode": {
                "type": "string",
                "description": "Transport mode to activate: 'auto' (WebSocket with Stream fallback), 'ws' (WebSocket only), or 'stream' (HTTP Long-Polling stream only).",
                "enum": ["auto", "ws", "stream"]
            }
        },
        "required": ["mode"]
    }
}
```

- [ ] **Step 2: Wire up Server-Side Handling in `src/mcp-handler.ts`**

1. Add `'get-transport-status'` and `'set-transport-mode'` to `SERVER_SIDE_TOOLS`.
2. Add handlers in `_runServerTool`:
```typescript
case 'get-transport-status': {
    return {
        success: true,
        mode: getTransportMode(),
        activeSessions: this.sessions.listActive(),
        wsConnections: this.wss.connectedCount,
        stats: this.queue.getStats()
    };
}
case 'set-transport-mode': {
    const mode = args.mode as 'auto' | 'ws' | 'stream';
    if (!['auto', 'ws', 'stream'].includes(mode)) {
        return { success: false, error: "Invalid mode. Use 'auto', 'ws', or 'stream'." };
    }
    setTransportMode(mode);
    return { success: true, mode };
}
```

- [ ] **Step 3: Mirror in `src/mcp-server.ts`**

Add tools to `SERVER_SIDE_TOOLS` in `src/mcp-server.ts` and dispatch in `runServerTool`.

- [ ] **Step 4: Verify TypeScript build**

Run: `npx tsc --noEmit`
Expected: EXIT=0

---

### Task 3: Client `public/mcp.lua` Real WebSocket & Stream Implementation

**Files:**
- Modify: `public/mcp.lua`
- Copy: `C:\Users\riefa\AppData\Local\Real\data\sessions\editor\tabs\tab-52.luau`

**Interfaces:**
- Consumes: Real executor `s.__on_message_bind`, `GET /api/transport`, `POST /stream/register`, `GET /stream/poll`, `POST /stream/result`
- Produces: Dual transport worker supporting both WS and Stream

- [ ] **Step 1: Real WebSocket Event Binding Support**

In `public/mcp.lua` `wsReconnect`:
The inspection log revealed:
`keys=[__client_id:number, __on_close_bind:userdata, OnClose:userdata, __on_message_bind:Instance, __guard:userdata]`
Add detection for `__on_message_bind`:
```lua
local onMsg = nil
pcall(function()
    onMsg = s.OnMessage or s.onMessage or s.onmessage or s.Message
    if not onMsg and s.__on_message_bind and typeof(s.__on_message_bind) == "Instance" then
        onMsg = s.__on_message_bind.Event
    end
end)
```
And for OnClose:
```lua
local onClose = nil
pcall(function()
    onClose = s.OnClose or s.onclose or s.Close or s.Closed
    if not onClose and s.__on_close_bind and typeof(s.__on_close_bind) == "Instance" then
        onClose = s.__on_close_bind.Event
    end
end)
```

- [ ] **Step 2: Stream Mode Implementation in `public/mcp.lua`**

Add complete HTTP Stream / Long-Polling implementation:
```lua
local STREAM_BASE = "http://" .. HOST .. ":" .. PORT
local function httpRequest(opts)
    local fn = request or http_request or (syn and syn.request)
    if type(fn) == "function" then
        return fn(opts)
    end
    if opts.Method == "GET" and type(game.HttpGet) == "function" then
        local ok, body = pcall(game.HttpGet, game, opts.Url)
        return { Success = ok, StatusCode = ok and 200 or 500, Body = body }
    end
    if opts.Method == "POST" and type(HttpService.PostAsync) == "function" then
        local ok, body = pcall(HttpService.PostAsync, HttpService, opts.Url, opts.Body or "", Enum.HttpContentType.ApplicationJson)
        return { Success = ok, StatusCode = ok and 200 or 500, Body = body }
    end
    return { Success = false, StatusCode = 0, Error = "No HTTP request function available" }
end

local function streamRegister() ... end
local function streamPoll() ... end
local function streamSendResult(id, data, err, taskPid) ... end
local function runStreamWorker() ... end
```

- [ ] **Step 3: Transport Discovery & Auto-Switching**

At startup before connecting:
1. Query `GET /api/transport`:
```lua
local targetTransport = "auto"
pcall(function()
    local res = httpRequest({ Url = STREAM_BASE .. "/api/transport", Method = "GET" })
    if res and res.StatusCode == 200 then
        local data = jsonDecode(res.Body)
        if data and data.mode then
            targetTransport = data.mode
        end
    end
end)
```
2. If `targetTransport == "stream"`: launch `runStreamWorker()`.
3. If `targetTransport == "ws"`: launch WebSocket loop.
4. If `targetTransport == "auto"`: attempt WebSocket; if it fails after 2 attempts, seamlessly switch to Stream worker!

- [ ] **Step 4: Verify with `luaparse`**

Run: `node -e "const luaparse=require('luaparse');luaparse.parse(require('fs').readFileSync('public/mcp.lua','utf8'),{luaVersion:'5.1'});console.log('PARSE OK');"`
Expected: PARSE OK

- [ ] **Step 5: Sync `tab-52.luau`**

Copy `public/mcp.lua` to `C:\Users\riefa\AppData\Local\Real\data\sessions\editor\tabs\tab-52.luau`.

---

### Task 4: Documentation & Integration Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README.md**
Update tool count to 110 tools, document `get-transport-status` and `set-transport-mode`, and add a section explaining the Dual Transport architecture (WebSocket vs Stream).

- [ ] **Step 2: Run End-to-End Tests**
1. Test `GET /api/transport` returning JSON.
2. Test `POST /api/transport` toggling mode.
3. Test `POST /stream/register`, `GET /stream/poll`, `POST /stream/result` in Node.js test script.
4. Restart daemon server.
