# Implementation Plan: Roblox MCP v1.6.0

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement non-blocking remote event interception, `set-autoexecute` with `queue_on_teleport`, universal multi-session execution routing, enriched server APIs, and an ultra-modern cybernetic dashboard with searchable tool docs and UNC matrix.

**Architecture:**
1. In `public/mcp.lua`, fix `__namecall` by preserving `setnamecallmethod`, removing dual-hooking collisions, passing through original return values, and decoupling logging via an asynchronous queue.
2. Add `set-autoexecute` tool to `public/mcp.lua` and server using `queue_on_teleport` and `OnTeleport` event listener.
3. Update `src/mcp-handler.ts`, `src/ws-server.ts`, and `src/queue-manager.ts` to accept `worker_id`/`session_id`/`pid` on all tools, fanning out across all active sessions if omitted.
4. Add `/api/tools`, `/api/sessions`, `/api/autoexecute`, `/api/unc` endpoints and link connected sessions with OS processes in `src/server-core.ts`.
5. Rewrite `public/dashboard.html` into an obsidian cybernetic glassmorphic SPA with live tool documentation, UNC capability explorer, connected process matrix, and interactive controls.
6. Synchronize `public/mcp.lua` with Real editor's `tab-52.luau` and compile with `npm run build`.

**Tech Stack:** Node.js (Express, ws), TypeScript, Luau (Roblox executor UNC API), Modern Vanilla CSS/HTML/JS.

## Global Constraints
- Zero breaking changes to existing 110 tools.
- Strict Luau type safety: zero `pcall` generic mismatches, zero raw `G.MCP_*` accesses, zero unhandled optional metatables.
- `public/mcp.lua` must parse cleanly under `luaparse` with Lua 5.1 syntax compatibility.
- Zero external build or CDN dependencies for `dashboard.html` (100% offline-first).

---

### Task 1: Overhaul Remote Interception Hook Engine in `public/mcp.lua`

**Files:**
- Modify: `public/mcp.lua:2310-2500`

**Interfaces:**
- Consumes: `getnamecallmethod`, `setnamecallmethod`, `hookmetamethod`, `hookfunction`, `clonefunction`, `newcclosure`
- Produces: Seamless `RemoteEvent` and `RemoteFunction` pass-through with asynchronous logging and spoofing

- [ ] **Step 1: Declare `setnamecallmethod` safely at the top of `public/mcp.lua`**
```lua
local setnamecallmethod = setnamecallmethod or (syn and syn.set_namecall_method) or set_namecall_method
```

- [ ] **Step 2: Rewrite `newNamecall` and `ProcessOutgoing` in `handleRemoteSpy`**
1. Hook `__namecall` **only** when `hookmetamethod` is present; hook method functions only as fallback.
2. In `newNamecall`:
   - Call `setnamecallmethod(method)` before invoking `origNamecall`.
   - If blocked: return `nil` immediately.
   - If spoofed: return `origNamecall(self, table.unpack(callArgs))`.
   - If standard: return `origNamecall(...)`.
3. In `ProcessOutgoing`:
   - Enqueue lightweight reference `{ method = method, inst = inst, args = callArgs, time = tick() }` to `spyQueue`.
   - Process serialization and stack inspection asynchronously in a background queue worker to keep the game thread at 60 FPS.

- [ ] **Step 3: Verify syntax with `luaparse`**
Run: `node -e "const luaparse=require('luaparse');luaparse.parse(require('fs').readFileSync('public/mcp.lua','utf8'),{luaVersion:'5.1'});console.log('PARSE OK');"`
Expected: `PARSE OK`

---

### Task 2: Implement `set-autoexecute` Tool in `public/mcp.lua` & Server

**Files:**
- Modify: `public/mcp.lua`
- Modify: `src/server-core.ts`
- Modify: `src/tool-definitions.ts`

**Interfaces:**
- Consumes: `queue_on_teleport`, `Players.LocalPlayer.OnTeleport`
- Produces: Tool `set-autoexecute`, endpoint `/api/autoexecute`

- [ ] **Step 1: Implement `handleSetAutoexecute` in `public/mcp.lua`**
1. Resolve `queue_on_teleport`:
   ```lua
   local qot = queue_on_teleport or (syn and syn.queue_on_teleport) or queueonteleport or (fluxus and fluxus.queue_on_teleport)
   ```
2. Implement autoexecute registration function and connect to `LocalPlayer.OnTeleport`.
3. Register `["set-autoexecute"] = handleSetAutoexecute` in `HANDLERS`.

- [ ] **Step 2: Add REST endpoint `/api/autoexecute` in `src/server-core.ts`**
Provide GET and POST to read and toggle autoexecute preference globally.

- [ ] **Step 3: Add `set-autoexecute` to `src/tool-definitions.ts`**
Declare tool schema with `enabled: boolean` and target parameters.

- [ ] **Step 4: Verify syntax & build**
Run: `npx tsc --noEmit`
Expected: `EXIT=0`

---

### Task 3: Universal Multi-Session Execution Routing

**Files:**
- Modify: `src/mcp-handler.ts`
- Modify: `src/ws-server.ts`
- Modify: `src/tool-definitions.ts`

**Interfaces:**
- Consumes: `sessions.listActive()`, `queue.submitTask()`
- Produces: Multi-session broadcast with structured dictionary output or targeted single-session execution

- [ ] **Step 1: Update `src/ws-server.ts` task dispatch**
Route tasks directly to `this.workers.get(task.targetWorkerId)` when `task.targetWorkerId` is specified, preventing broadcast noise.

- [ ] **Step 2: Implement Multi-Session Fanout in `src/mcp-handler.ts`**
1. Extract `worker_id`, `session_id`, `sessionId`, `workerId`, or `pid` from tool arguments.
2. If targeted: execute on specified worker.
3. If untargeted:
   - If 1 session: execute directly.
   - If $>1$ sessions: execute on all active sessions via `Promise.allSettled`, returning `{ multi_session: true, total, results: { [workerId]: { success, pid, name, data/error } } }`.

- [ ] **Step 3: Augment all tool schemas in `src/tool-definitions.ts`**
Add optional `worker_id` and `pid` properties to every executor tool definition.

- [ ] **Step 4: Verify build**
Run: `npm run build`
Expected: `EXIT=0`

---

### Task 4: Enriched Server Management & Telemetry REST APIs

**Files:**
- Modify: `src/server-core.ts`

**Interfaces:**
- Produces: `/api/tools`, `/api/sessions`, `/api/unc`, updated `/api/processes` and `/health`

- [ ] **Step 1: Implement `/api/tools`**
Return array of all tools with categorized tags, parameter schemas, and descriptions.

- [ ] **Step 2: Implement `/api/sessions`**
Return active session array with transport, player metadata, place info, and heartbeat status.

- [ ] **Step 3: Enrich `/api/processes`**
Match OS Roblox processes against registered sessions and flag `isConnected: boolean` with linked `worker_id`.

- [ ] **Step 4: Implement `/api/unc`**
Return aggregated capability matrix of active executors.

- [ ] **Step 5: Test endpoints via curl or node script**
Verify all endpoints return valid JSON HTTP 200.

---

### Task 5: Complete Rewrite of `public/dashboard.html`

**Files:**
- Modify: `public/dashboard.html`

**Interfaces:**
- Consumes: `/health`, `/api/transport`, `/api/autoexecute`, `/api/sessions`, `/api/processes`, `/api/tools`, `/api/unc`
- Produces: High-end responsive Obsidian Cybernetic dashboard with search, interactive runner, and process manager

- [ ] **Step 1: Design System & Styling**
Implement obsidian dark palette (`#08090d`), glassmorphic panels, neon accent variables, responsive grid, and smooth CSS transitions.

- [ ] **Step 2: HUD & Control Ribbon**
Build status badge, uptime timer, transport segmented toggle (`Auto`/`WS`/`Stream`), autoexecute toggle, and one-click inject command copy.

- [ ] **Step 3: Process & Session Matrix**
Render linked connected worker cards (player avatar, place name, transport badge, kill/restart) and unconnected Roblox windows.

- [ ] **Step 4: Tool Documentation & Interactive Test Runner**
Render searchable 110+ tool catalog with category filters, schema parameter viewer, and "Run Tool" form drawer with live JSON response display.

- [ ] **Step 5: UNC Capability Explorer**
Render visual grid of 37+ UNC functions with categories and support indicators.

---

### Task 6: Synchronization, Testing & Final Verification

**Files:**
- Sync: `C:\Users\riefa\AppData\Local\Real\data\sessions\editor\tabs\tab-52.luau`
- Update: `README.md`

- [ ] **Step 1: Sync `tab-52.luau` in Real editor**
Copy updated `public/mcp.lua` to Real's tab file.

- [ ] **Step 2: Restart Server Daemon**
Restart `roblox-mcp` daemon to load new routes and compiled dist.

- [ ] **Step 3: Run Full System Verification Suite**
1. Check `luaparse` on `public/mcp.lua`.
2. Check `npm run build`.
3. Test multi-session mock routing.
4. Test `/api/tools`, `/api/sessions`, `/api/autoexecute`.
5. Verify dashboard renders cleanly in browser.
