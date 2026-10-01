# PRD: Roblox MCP v1.7.0 — Tool Simplification & Core Pruning

## 1. Executive Summary

### 1.1 Problem Statement
The current tool catalog contains **111 tools**, but many are redundant, unimplemented ("Not implemented in executor"), overlapping, or have convoluted descriptions that confuse LLMs and users:
1. **Unimplemented Stub Tools**: Tools like `record-macro` and `replay-macro` literally return `"Macro recorder not implemented in executor"` in `public/mcp.lua`.
2. **Overlapping Duplicates**:
   - `install-remote-spy`, `block-remote`, `toggle-remote-killswitch`, `spoof-remote-args`, `set-remote-filter` are all redundant duplicates of `spy-remotes`.
   - `click-button` and `click-ui-element` do the exact same action.
   - `execute-file` is completely redundant with `execute-script` (which already accepts `file` or `code`).
   - `inspect-property` duplicates `read-properties`.
   - `set-raw-metatable` duplicates `modify-metatable`.
   - `simulate-touch` literally just maps to `handleMouseMove`.
3. **Verbose & Jargon-Heavy Descriptions**: Tool descriptions are currently walls of text that consume unnecessary context window tokens and confuse agentic planners.
4. **Universal `workerId` Optionality**: `workerId` must be the first parameter in all tools, strictly optional, and if empty/omitted automatically execute across all connected Roblox sessions.

### 1.2 Proposed Solution
- **Prune Dead & Duplicate Tools**: Eliminate dummy stub tools (`record-macro`, `replay-macro`) and consolidate redundant duplicates into clean, unified, master tools.
- **Streamlined Tool Names & Descriptions**: Rewrite all tool names and descriptions to be crisp, memorable, punchy, and self-explanatory (e.g. `get-local-player` -> `get-player`, `dump-workspace-players` -> `get-all-players`, `dump-remote-events` -> `list-remotes`, etc., while retaining backward-compatible aliases in `mcp.lua` so no scripts or prompts break).
- **Universal Optional `workerId`**: Every single tool's first argument is `workerId?: string`. If omitted, the MCP server automatically executes the tool across all connected Roblox game windows.

### 1.3 Success Criteria
- Tool count streamlined from 111 bloated tools to ~60-70 ultra-high-utility, distinct tools.
- Zero "not implemented" tools.
- All tools have concise, 1-2 sentence descriptions (< 150 chars).
- `workerId` is the first property in every tool schema, marked optional.
- 100% backward-compatible execution in `public/mcp.lua` via aliases.

---

## 2. Scope & Tool Pruning Audit

### 2.1 Tools to Remove (Dead / Fake / 100% Duplicate)
| Old Tool | Reason for Removal | Replacement / Unified Tool |
|---|---|---|
| `record-macro` | Stub: returns "not implemented" in Lua | REMOVE |
| `replay-macro` | Stub: returns "not implemented" in Lua | REMOVE |
| `simulate-touch` | Redundant: literally routes to `handleMouseMove` | Use `move-mouse` |
| `click-ui-element` | Redundant duplicate of `click-button` | Use `click-button` |
| `execute-file` | Redundant duplicate of `execute-script` (has `file` parameter) | Use `execute-script` |
| `inspect-property` | Redundant duplicate of `read-properties` | Use `read-properties` |
| `set-raw-metatable` | Redundant duplicate of `modify-metatable` | Use `modify-metatable` |
| `install-remote-spy` | Redundant alias for `spy-remotes(action="install")` | Use `spy-remotes` |
| `block-remote` | Redundant alias for `spy-remotes(action="block")` | Use `spy-remotes` |
| `toggle-remote-killswitch` | Redundant alias for `spy-remotes(action="block_all")` | Use `spy-remotes` |
| `spoof-remote-args` | Redundant alias for `spy-remotes(action="spoof")` | Use `spy-remotes` |
| `set-remote-filter` | Redundant alias for `spy-remotes(action="set_filter")` | Use `spy-remotes` |
| `get-siblings` | Overly specialized: easily done with `get-children` on parent | Consolidate into `get-children` / `find-instances` |
| `get-instances-by-subclass` | Redundant with `get-instances-by-class(include_subclasses=true)` | Use `get-instances-by-class` |
| `get-workspace-objects` | Redundant with `walk-tree` / `get-instances-by-class` | Use `walk-tree` |
| `get-instance` | 100% duplicate of `resolve-path` | Use `resolve-path` |
| `dump-gui` | Redundant: `take-screenshot` or `dump-gui-hierarchy` | Use `take-screenshot` / `dump-gui-hierarchy` |
| `get-geometry` | Overly specialized: bounding box on single part | Consolidate into `read-properties` |
| `check-closure-type` | Minor utility: easily covered by `get-debug-info` | Consolidate into `get-debug-info` |
| `get-constants-upvalues` | 100% duplicate of `inspect-closure` | Use `inspect-closure` |
| `get-class-blueprint` | Giant static reflection dump, rarely useful for AI | Optional or streamline |

### 2.2 Renaming & Simplifying Remaining Tools
Simplify names to clean, intuitive, kebab-case verbs:
- `dump-workspace-players` -> `get-players` ("Get all players, characters, health, and backpacks")
- `get-local-player` -> `get-player` ("Get the local player character, leaderstats, and inventory")
- `dump-remote-events` -> `list-remotes` ("Scan game for all RemoteEvents and RemoteFunctions")
- `dump-gui-hierarchy` -> `get-gui-tree` ("Get visual hierarchy of CoreGui and PlayerGui")
- `get-instances-by-class` -> `find-instances` ("Find instances in game tree by class, name, or parent")
- `extract-screen-text` -> `get-screen-text` ("Extract rendered text from visible on-screen GUI elements")
- `get-script-source` -> `get-script` ("Retrieve decompiled Luau source or bytecode of a script")
- `inspect-remote-connections` -> `get-remote-handlers` ("List connection handlers attached to a RemoteEvent")
- `modify-local-player` -> `set-player` ("Modify player properties: WalkSpeed, JumpPower, Noclip, InfiniteJump")
- `teleport-player` -> `teleport` ("Teleport local player to coordinates, player, or part")
- `disable-anticheat` -> `bypass-anticheat` ("Disable client anticheat kicks, detections, and idle timeouts")
