# Implementation Plan: Roblox MCP v1.7.0 — Simplified Tools Architecture

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Streamline the tool catalog by pruning dead/duplicate tools, simplifying tool names and descriptions, ensuring `workerId` is universally the optional first argument, and keeping full backward compatibility via aliases.

**Architecture:**
- `src/tool-definitions.ts`: Define ~65 core tools with concise descriptions, simplified names, and `workerId` as the optional first property.
- `public/mcp.lua`: Register both new simplified names and legacy aliases in `HANDLERS` so all existing code and prompts continue functioning seamlessly.
- `src/server-core.ts`: Update tool category mapping for `/api/tools`.
- `public/dashboard.html` & `README.md`: Reflect the streamlined tool catalog.

---

### Task 1: Add Simplified Tool Aliases in `public/mcp.lua`
- [ ] Add new tool name mappings to `HANDLERS` in `public/mcp.lua`:
  - `get-player` -> `handlePlayerState`
  - `get-players` -> `handleDumpPlayers`
  - `list-remotes` -> `handleDumpRemotes`
  - `get-gui-tree` -> `handleGuiDump`
  - `get-screen-text` -> `handleScreenText`
  - `get-script` -> `handleScriptSource`
  - `get-remote-handlers` -> `handleRemoteConns`
  - `set-player` -> `handleStateBypass`
  - `teleport` -> `handleStateBypass`
  - `bypass-anticheat` -> `handleDisableAntiCheat`
  - `find-instances` -> `handleTreeExplore` (action: "class_collect")
  - `get-script-env` -> `handleScriptEnv`
  - `get-roblox-env` -> `handleRobloxEnv`
- [ ] Verify syntax with `luaparse`.

### Task 2: Streamline `src/tool-definitions.ts`
- [ ] Define clean, high-signal tool list with concise descriptions.
- [ ] Ensure `workerId` is the first property in `properties`, not in `required`.
- [ ] Remove dead stubs (`record-macro`, `replay-macro`) and 100% duplicate tools.

### Task 3: Update `server-core.ts` & Dashboard Categories
- [ ] Update category matcher in `/api/tools`.
- [ ] Update `public/dashboard.html` category pills and counts.
- [ ] Update `README.md` tools overview.

### Task 4: Recompile & End-to-End Verification
- [ ] Compile with `npm run build`.
- [ ] Sync `tab-52.luau`.
- [ ] Restart daemon.
- [ ] Test calling both new names (`get-player`, `list-remotes`) and old names (`get-local-player`, `dump-remote-events`).
