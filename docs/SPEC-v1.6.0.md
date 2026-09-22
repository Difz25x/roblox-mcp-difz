# Technical Specification: Roblox MCP v1.6.0

## 1. System Architecture & Component Interactions

```
┌────────────────────────────────────────────────────────────────────────┐
│                        AI Client (Claude Code / Cursor)                │
│             Calls any tool with optional `worker_id` / `pid`           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP JSON-RPC / Stdio
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        mcp-handler.ts                                  │
│  - Parses target `worker_id`, `session_id`, `pid`                      │
│  - Single Target Execution (direct response)                           │
│  - Multi-Session Fanout (Promise.allSettled -> table per worker)       │
└──────────────────┬────────────────────────────────┬────────────────────┘
                   │                                │
                   ▼                                ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────┐
│          queue-manager.ts            │  │        server-core.ts        │
│  - submitTask(type, args, opts)      │  │  - GET /api/tools            │
│  - TaskQueue matching targetWorkerId │  │  - GET /api/sessions         │
│  - Stream / WS Poller dispatch       │  │  - GET /api/processes (live) │
└──────────┬───────────────────────────┘  │  - GET /api/unc              │
           │                              │  - GET/POST /api/autoexecute │
           ├─────────────────────────┐    │  - GET /dashboard.html       │
           ▼                         ▼    └──────────────────────────────┘
┌─────────────────────┐   ┌───────────────────────┐
│     ws-server.ts    │   │  Stream Long-Polling  │
│ - Targeted socket   │   │  (/stream/poll,       │
│ - Broadcast fallback│   │   /stream/result)     │
└──────────┬──────────┘   └──────────┬────────────┘
           │ WebSocket               │ HTTP Long-Poll
           ▼                         ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   public/mcp.lua (Roblox Client)                       │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 1. Hook Engine: Non-blocking setnamecallmethod preservation      │  │
│  │ 2. Autoexecute: queue_on_teleport + OnTeleport hook              │  │
│  │ 3. Dual Transport Worker: WebSocket + HTTP Stream               │  │
│  │ 4. 110+ Tool Dispatcher: returns data with exact task ID         │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Remote Interception & Namecall Hook Overhaul

### 2.1 The Root Cause of Remote Interception Lockup
In `mcp.lua`, when `spy-remotes` is installed, outgoing remote traffic was failing due to three critical flaws:
1. **Invalidated Namecall Register**: In Roblox Luau VM, `o:Method(...)` produces a `NAMECALL` opcode storing the method name in internal register state. Any Luau call (such as `pcall`, accessing `inst.Name`, or `getFullPath`) made *inside* the hook routine wipes this register. When `origNamecall(self, ...)` is called subsequently, the engine has lost the method name and the call fails silently or throws, preventing the remote packet from ever reaching the Roblox network layer.
2. **Double Hooking Collision**: The script previously hooked BOTH `__namecall` AND individual methods (`RemoteEvent.FireServer`, `RemoteFunction.InvokeServer`, etc.). Calling `origNamecall` caused the method hook to trigger a second time, multiplying overhead, deadlocking, or creating recursion traps.
3. **Blocking Serialization in Call Path**: Serializing complex arguments (`serialize(callArgs)`) and resolving full hierarchical paths on the execution thread caused micro-freezes, thread starvation, and timing desyncs with server replication.
4. **Broken `InvokeServer` Return Tuple**: `RemoteFunction:InvokeServer` yields until the server responds. When blocked or intercepted incorrectly, no return value was provided, permanently hanging the calling game script.

### 2.2 The Solution Architecture
1. **Namecall First, Method Fallback (Mutually Exclusive)**:
   - If `hookmetamethod` is available, hook `__namecall` **only**. Do NOT hook individual methods.
   - If `hookmetamethod` is NOT available, hook `FireServer`, `InvokeServer`, `UnreliableFireServer` individually.
2. **Mandatory `setnamecallmethod`**:
   Before invoking `origNamecall(self, ...)`, always execute `setnamecallmethod(method)`:
   ```lua
   if setnamecallmethod then
       setnamecallmethod(method)
   end
   return origNamecall(self, ...)
   ```
3. **Decoupled Asynchronous Logging Queue**:
   Instead of doing path resolution and argument serialization inside the hook, push a lightweight reference to a thread-safe FIFO buffer:
   ```lua
   local spyQueue = {}
   table.insert(spyQueue, { method = method, inst = inst, args = callArgs, time = tick() })
   ```
   A background `task.spawn` worker drains `spyQueue`, serializes arguments safely, and pushes entries to `spyLogs`.
4. **Precise Argument Spoofing**:
   If spoofing rules apply, unpack the modified arguments:
   ```lua
   if isSpoofed then
       if setnamecallmethod then setnamecallmethod(method) end
       return origNamecall(self, unpack(callArgs))
   else
       if setnamecallmethod then setnamecallmethod(method) end
       return origNamecall(self, ...)
   end
   ```
5. **Clean RemoteFunction Block Return**:
   If a `RemoteFunction` is blocked, immediately return `nil` to allow the game script thread to resume rather than hang forever.

---

## 3. `set-autoexecute` & Teleport Engine Spec

### 3.1 Functionality
Enables persistent execution of `mcp.lua` across teleports between places/universes.

### 3.2 Tool Definition
```json
{
  "name": "set-autoexecute",
  "description": "Configure automatic re-execution of the MCP client script when the player teleports to any other Roblox place or server using queue_on_teleport.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "enabled": {
        "type": "boolean",
        "description": "True to enable autoexecute on teleport, false to disable."
      }
    },
    "required": ["enabled"]
  }
}
```

### 3.3 Lua Client Implementation
```lua
local qot = queue_on_teleport or (syn and syn.queue_on_teleport) or queueonteleport or (fluxus and fluxus.queue_on_teleport)
local autoexecEnabled = false
local teleportConn = nil

local function getAutoexecScript()
    return string.format('loadstring(game:HttpGet("http://%s:%d/mcp.lua"))()', HOST, PORT)
end

local function applyAutoexecute(enable)
    autoexecEnabled = enable
    G_SET("MCP_AUTOEXECUTE", enable)
    
    if enable and type(qot) == "function" then
        -- Prime queue immediately for any in-flight teleport
        pcall(qot, getAutoexecScript())
        
        -- Hook OnTeleport event
        if not teleportConn and LocalPlayer then
            pcall(function()
                teleportConn = LocalPlayer.OnTeleport:Connect(function(state)
                    if G_GET("MCP_AUTOEXECUTE") and type(qot) == "function" then
                        pcall(qot, getAutoexecScript())
                    end
                end)
            end)
        end
        return true, "Autoexecute armed via queue_on_teleport and OnTeleport hook"
    elseif not enable then
        if teleportConn then
            pcall(function() teleportConn:Disconnect() end)
            teleportConn = nil
        end
        return true, "Autoexecute disarmed"
    else
        return false, "queue_on_teleport not supported by this executor"
    end
end
```

---

## 4. Universal Multi-Session Execution Architecture

### 4.1 Tool Argument Standard
Every MCP tool inputSchema in `src/tool-definitions.ts` is augmented with:
- `worker_id` (`string`, optional): Target a specific Roblox session by worker ID.
- `pid` (`number`, optional): Target a specific Roblox process by OS Process ID.

### 4.2 Router Logic in `src/mcp-handler.ts`
```typescript
const targetWorker = (args?.worker_id || args?.session_id || args?.sessionId || args?.workerId) as string | undefined;
const targetPid = args?.pid ? Number(args.pid) : undefined;

const activeSessions = this.sessions.listActive();
if (activeSessions.length === 0) {
    return {
        result: {
            content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'No Roblox executor is connected.' }, null, 2) }],
            isError: true,
            meta: { tool: name }
        }
    };
}

// Case 1: Specific worker requested
if (targetWorker) {
    const res = await this.queue.submitTask(name, args, { workerId: targetWorker, timeoutMs });
    return { result: { content: [{ type: 'text', text: typeof res === 'string' ? res : JSON.stringify(res, null, 2) }] } };
}

// Case 2: Specific PID requested
if (targetPid) {
    const res = await this.queue.submitTask(name, args, { targetPid, timeoutMs });
    return { result: { content: [{ type: 'text', text: typeof res === 'string' ? res : JSON.stringify(res, null, 2) }] } };
}

// Case 3: Single active session (direct execution)
if (activeSessions.length === 1) {
    const singleWorker = activeSessions[0].workerId;
    const res = await this.queue.submitTask(name, args, { workerId: singleWorker, timeoutMs });
    return { result: { content: [{ type: 'text', text: typeof res === 'string' ? res : JSON.stringify(res, null, 2) }] } };
}

// Case 4: Multiple active sessions and no target specified -> Fanout Broadcast
const results: Record<string, any> = {};
await Promise.all(activeSessions.map(async (worker) => {
    try {
        const res = await this.queue.submitTask(name, args, { workerId: worker.workerId, timeoutMs });
        results[worker.workerId] = {
            success: true,
            pid: worker.pid,
            name: worker.name,
            data: res
        };
    } catch (err: any) {
        results[worker.workerId] = {
            success: false,
            pid: worker.pid,
            error: err.message
        };
    }
}));

return {
    result: {
        content: [{ type: 'text', text: JSON.stringify({ multi_session: true, total: activeSessions.length, results }, null, 2) }],
        meta: { tool: name, sessions_executed: activeSessions.length }
    }
};
```

---

## 5. Server Management & Telemetry REST APIs

| Endpoint | Method | Response Payload Description |
|---|---|---|
| `/api/tools` | GET | List of all 110+ tools with name, description, category, and parameters |
| `/api/sessions` | GET | Active and recent worker sessions, transport mode, place name, player info, latency |
| `/api/processes` | GET | OS Roblox processes with `isConnected: boolean` flag matching worker sessions |
| `/api/unc` | GET | Aggregated UNC capability report from connected executors |
| `/api/autoexecute` | GET/POST | Current autoexecute preference state |
| `/api/transport` | GET/POST | Transport mode (`auto` / `ws` / `stream`), connection counters, URLs |
| `/health` | GET | System health, uptime, memory, queue depth, throughput |

---

## 6. Next-Gen Cybernetic Dashboard Specification

### 6.1 Design Philosophy
- **Aesthetic**: Obsidian Void Cybernetic (deep black ground `#08090d`, subtle border glow `#1e2433`, neon cyber cyan `#00f0ff`, electric violet `#8a2be2`, phosphor emerald `#00ff88`, warning amber `#ffb800`).
- **Typography**: Space Grotesk / Inter / JetBrains Mono (with resilient system fallbacks `system-ui, -apple-system, sans-serif`).
- **Components**:
  1. **Top HUD Bar**: Live server status indicator (pulsing glow), uptime counter, port, version, active worker badge.
  2. **Global Controls Ribbon**:
     - Mode Selector: `Auto` | `WebSocket` | `Stream` (interactive segmented toggle).
     - Autoexecute Switch: Toggle with live status badge.
     - One-Click Loader: Copy `loadstring(game:HttpGet("..."))()` with visual feedback.
  3. **Live Process & Session Grid**:
     - Split into Connected Workers (green badge, player avatar placeholder, place title, transport tag, kill/restart) and Unconnected Roblox Windows (orange badge, PID, inject reminder).
  4. **Interactive Tool Documentation & Live Tester**:
     - Search bar with instant real-time filter across 110+ tools.
     - Category pills (`All`, `Networking`, `Inspection`, `Player`, `GUI`, `Filesystem`, `Input`, `Server`).
     - Tool Card expandable with description, parameters table, and "Quick Execute" playground.
  5. **UNC Engine Capability Matrix**:
     - Visual badge array of all 37 UNC functions with categorized tags and executor detection status.
  6. **Zero Dependencies**: 100% self-contained single-file HTML/CSS/JS without external CDN scripts to guarantee functionality in air-gapped or restricted network environments.
