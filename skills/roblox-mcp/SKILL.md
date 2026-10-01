---
name: roblox-mcp
description: Master control, automation, reverse engineering, inspection, Luau execution, and telemetry for Roblox clients via the roblox-mcp protocol. Use when analyzing Roblox games, inspecting instance trees, executing Luau scripts, decompiling bytecode, spying on RemoteEvents, manipulating players, simulating inputs, capturing screenshots/video, or testing multi-client Roblox sessions.
---

# Roblox MCP — Agent Engineering & Mastery Skill

This skill guides AI agents (Claude Code, Cursor, Windsurf, Copilot, etc.) on how, when, and why to use the **`roblox-mcp`** tool suite to automate, reverse-engineer, inspect, and test Roblox games across single or multiple Windows processes.

---

## 1. System Architecture & Session Routing

Roblox MCP operates as a bidirectional bridge connecting AI agents to in-game Roblox executor clients over WebSocket (`ws://localhost:28429`) with automatic long-polling HTTP Stream fallback. A background Discovery Router (`http://127.0.0.1:58295`) automatically resolves custom server ports.

### Universal Session Targeting (`workerId` & `pid`)
Every tool accepts two universal, optional session routing arguments as its first properties:
- `workerId?: string`: Target a specific client session by ID, username, or session name (e.g. `"Worker_14388"`, `"Player1"`).
- `pid?: number`: Target a specific Roblox client window by operating system Process ID (e.g. `14388`).
- **If omitted**: The tool automatically executes across **ALL** active connected sessions or defaults to the primary active session.

---

## 2. Universal Argument Normalization (AI Error Tolerance)

The server features automatic bidirectional argument normalization. You do **not** need to worry about rigid schema mismatches:
- **Path & Instance Aliases**: `target_path`, `script_path`, `instance_path`, `target_part`, `part_path`, `path`, `target`, and `instance` are completely interchangeable.
- **Casing**: Both `camelCase` (e.g. `targetPath`, `placeId`, `jobId`) and `snake_case` (e.g. `target_path`, `place_id`, `job_id`) are accepted everywhere.
- **Code & Content**: `code`, `script`, `source`, `content`, and `lua` are interchangeable.
- **Property Maps**: `property_map` and `properties` accept either a stringified JSON string (`'{"Transparency":0.5}'`) or a direct JSON object (`{ "Transparency": 0.5 }`).
- **Player Targets**: `player`, `player_name`, `username`, and `target_player` are interchangeable.
- **Coordinates & Teleport**: Accepts `coordinates: { x, y, z }`, flat `x, y, z`, `player: "Name"`, or `target_part: "workspace.Part"`.

---

## 3. Tool Catalog by Operational Domain

### A. Server, Process & Media Telemetry
| Tool Name | Core Purpose | Key Arguments |
|---|---|---|
| `launch-roblox` | Launches Roblox Player desktop application or client. | `path?: string` |
| `list-roblox-processes` | Lists active Roblox Windows processes, memory in MB, PIDs, and window titles. | (none) |
| `open-roblox-game` | Launches or joins a specific place by PlaceId, JobId, or Private Server Code. | `place_id: number`, `job_id?: string`, `private_server_link_code?: string` |
| `take-screenshot` | Captures window screenshot frame as base64 PNG or saves to disk. | `pid?: number`, `output_path?: string` |
| `record-roblox-video` | Records MP4 video of game window with configurable FPS. | `duration_seconds: number`, `fps?: number` (1-60, default 30), `pid?: number`, `output_path?: string` |
| `get-transport-status` | Inspects active transport mode (`auto`, `ws`, `stream`), worker counts, and health. | (none) |
| `set-transport-mode` | Switches transport between `auto`, `ws`, and `stream`. | `mode: "auto" \| "ws" \| "stream"` |

### B. Scripting, Decompilation & Execution
| Tool Name | Core Purpose | Key Arguments |
|---|---|---|
| `execute-script` | Executes Luau code string or local file (`.lua`, `.luau`, `.txt`). | `code?: string`, `file?: string`, `async?: boolean` |
| `get-script` *(alias: `decompile-script`)* | Decompiles Luau source code or retrieves bytecode. | `target_path: string` (or `script_path`), `decompile?: boolean` |
| `get-loaded-modules` | Lists all cached `ModuleScript` instances in the Lua VM registry. | `filter_by_name?: string` |
| `get-running-scripts` | Discovers actively running scripts (`Scripts` and `LocalScripts`). | `max_scripts?: number` |
| `get-script-env` | Dumps script local environment variables and internal functions (`getsenv`). | `script_path: string` |
| `get-roblox-env` | Inspects global Roblox environment (`getrenv`) and executor globals (`getgenv`). | (none) |
| `analyze-sandbox` | Analyzes thread identity (`getthreadidentity`) and executor capability flags. | (none) |
| `check-unc` | Tests executor compliance against the Universal Naming Convention specification. | (none) |

### C. Remote Spy & Network Telemetry
| Tool Name | Core Purpose | Key Arguments |
|---|---|---|
| `list-remotes` *(alias: `dump-remote-events`)* | Scans game tree for all `RemoteEvent` and `RemoteFunction` instances. | (none) |
| `fire-remote` | Dispatches client-to-server network requests (`FireServer` or `InvokeServer`). | `remote_path: string`, `arguments?: string` (JSON array or args) |
| `spy-remotes` | Installs real-time network spy, monitors calls, blocks remotes, or filters traffic. | `action: "install" \| "read" \| "clear" \| "block" \| "block_all" \| "spoof"`, `filter_remote_path?: string` |
| `get-remote-handlers` | Inspects connection handlers and callback closures listening on a remote. | `remote_path: string` |
| `check-replication` | Verifies client-server property synchronization and network latency. | (none) |
| `fire-signal` | Simulates engine signals (`ClickDetector`, `ProximityPrompt`, `GuiButton.Activated`). | `signal_path: string` |

### D. Instance Tree & World Exploration
| Tool Name | Core Purpose | Key Arguments |
|---|---|---|
| `find-instances` | Searches instances by ClassName (e.g. `'Part'`, `'RemoteEvent'`). | `class_name: string`, `scope?: string`, `max_results?: number` |
| `walk-tree` | Recursively walks the game hierarchy from root with a depth limit. | `root_path?: string`, `max_depth?: number` |
| `resolve-path` | Verifies an instance path string and returns properties and existence status. | `path: string` |
| `get-children` | Lists direct children of an instance or watches additions/removals over time. | `target_path: string`, `duration_ms?: number` |
| `find-by-property` | Scans for instances matching a specific property value (e.g. `Material="Neon"`). | `property_name: string`, `property_value: string`, `scope?: string` |
| `find-by-tag` | Finds instances tagged via `CollectionService:GetTagged(tag)`. | `tags: string[]` |
| `find-by-attribute` | Finds instances containing a specific custom attribute. | `attribute_name: string`, `attribute_value?: any`, `scope?: string` |
| `scan-proximity` | Discovers 3D objects within a radial sphere around coordinates. | `position: { x, y, z }`, `radius: number`, `class_filter?: string` |
| `scan-nil-instances` | Uncovers hidden instances parented to `nil` or cached in memory (`getnilinstances`). | `filter_by_class?: string`, `max_instances?: number` |
| `compare-instances` | Compares properties between two instances and returns structural diff. | `path_a: string`, `path_b: string` |

### E. Instance & Property Manipulation
| Tool Name | Core Purpose | Key Arguments |
|---|---|---|
| `read-properties` | Reads multiple properties simultaneously from an instance. | `instance_path: string`, `property_list: string[]` |
| `set-properties` | Writes properties on a target instance (`Transparency`, `CanCollide`, `Size`, etc.). | `target_path: string`, `property_map: string \| object` |
| `create-instance` | Instantiates a new Instance of any class and parents it into the game tree. | `class_name: string`, `parent_path: string`, `instance_name?: string` |
| `clone-instance` | Clones an existing instance and sets its destination parent. | `source_path: string`, `parent_path: string` |
| `destroy-instance` | Calls `:Destroy()` on instances or reparents them to `nil`. | `target_paths: string[]` |

### F. Player & Character Control
| Tool Name | Core Purpose | Key Arguments |
|---|---|---|
| `get-player` | Inspects local player character, Humanoid, leaderstats, and inventory. | (none) |
| `get-players` | Dumps all server players, usernames, character positions, and teams. | (none) |
| `set-player` | Modifies player attributes: `WalkSpeed`, `JumpPower`, `Noclip`, `InfiniteJump`, `Health`. | `property_map: string \| object`, `duration?: number` |
| `teleport` | Instant CFrame teleportation to coordinates, target player, or part. | `coordinates?: { x, y, z }`, `player?: string`, `target_part?: string` |
| `bypass-anticheat` | Disables client kick dialogs, idle 20-min AFK disconnect, and teleport locks. | `hook_kick?: boolean`, `anti_afk?: boolean`, `block_teleport?: boolean` |
| `get-humanoid-state` | Retrieves the current `Enum.HumanoidStateType` (Running, Freefall, Jumping, etc.). | `humanoid_path: string` |
| `send-chat` | Dispatches chat messages via `TextChatService` or `LegacyChatService`. | `message: string`, `channel?: string` |

### G. GUI, Visual & Screen Interaction
| Tool Name | Core Purpose | Key Arguments |
|---|---|---|
| `get-gui-tree` | Dumps visual UI hierarchy of `PlayerGui`, `CoreGui`, or `StarterGui`. | `root_container?: "PlayerGui" \| "CoreGui"`, `max_depth?: number` |
| `get-screen-text` | Extracts all rendered text visible on screen from TextLabels and TextButtons. | (none) |
| `click-button` | Programmatically triggers Click / Activated events on any `GuiButton`. | `path: string` |
| `inject-gui` | Injects custom `ScreenGui` elements, HUDs, or overlays into the local player view. | `name: string`, `children?: string` |
| `manage-esp` | Renders 3D Billboard text labels above players or items. | `action: "create" \| "update" \| "remove" \| "remove_all"`, `target_identifier?: string`, `label_text?: string` |
| `world-to-screen` | Converts 3D world vectors into 2D viewport pixel coordinates. | `world_positions: Array<{ x, y, z }>` |
| `track-cursor` | Retrieves current screen mouse position and viewport boundaries. | (none) |
| `hide-notifications` | Hides or clears Roblox system notification popups. | `action: "hide" \| "scan" \| "destroy"` |

### H. Input Simulation
| Tool Name | Core Purpose | Key Arguments |
|---|---|---|
| `move-character` | Navigates character to 3D world coordinates using WASD simulation. | `target_x: number`, `target_z: number`, `sprint?: boolean` |
| `move-mouse` | Moves mouse cursor to screen pixel coordinates `(X, Y)`. | `x: number`, `y: number` |
| `click-mouse` | Simulates left, right, or middle mouse clicks. | `button?: "LeftButton" \| "RightButton" \| "MiddleButton"` |
| `hold-mouse` | Holds down or releases mouse button for dragging. | `action: "down" \| "up"`, `button?: string` |
| `scroll-mouse` | Simulates mouse wheel scrolling. | `delta: number` (positive = up, negative = down) |
| `press-key` | Simulates keyboard key presses (`KeyCode` string, e.g. `'E'`, `'Space'`). | `key_code: string` |
| `hold-key` | Holds down keyboard keys for a set duration. | `key_code: string`, `duration_ms: number` |
| `type-text` | Types text into focused UI inputs or chat prompts. | `text: string`, `press_enter_after?: boolean` |
| `control-camera` | Sets camera CFrame, field of view, locks to part, or sets first/third person. | `action: string`, `target_fov?: number` |
| `interact-prompts` | Triggers all nearby `ProximityPrompt` or `ClickDetector` instances instantly. | `range?: number` (studs) |

### I. Memory & Low-Level Reflection
| Tool Name | Core Purpose | Key Arguments |
|---|---|---|
| `inspect-metatable` | Audits metamethods (`__index`, `__newindex`, `__namecall`) on an object. | `target_path: string` |
| `modify-metatable` | Modifies, detours, or makes metatables writable (`setreadonly`). | `target_path: string`, `action: "set_readonly" \| "set_raw"` |
| `toggle-readonly` | Toggles readonly flag of tables or metatables. | `target_path: string`, `state: boolean` |
| `hook-function` | Detours or instruments Luau closures or methods with custom telemetry. | `function_path: string`, `replacement_code: string` |
| `scan-registry` | Inspects global Lua registry table (`getreg()`). | `filter_type?: string` |
| `scan-gc` | Traverses garbage collector objects (`getgc()`) to find hidden functions/tables. | `filter_type?: "function" \| "table"` |
| `inspect-closure` | Inspects upvalues, constants, and prototypes of a closure (`getupvalues`). | `closure_path: string` |
| `get-debug-info` | Extracts source file, line numbers, and parameters using `debug.getinfo`. | `function_path: string` |
| `get-hidden-property` | Accesses hidden or internal engine properties. | `instance_path: string`, `property: string` |
| `set-hidden-property` | Overwrites hidden engine properties (`sethiddenproperty`). | `instance_path: string`, `property: string`, `value: any` |
| `set-scriptable` | Toggles scriptable flag on unscriptable instance properties (`setscriptable`). | `class_name: string`, `property: string`, `scriptable: boolean` |

### J. Filesystem Operations
| Tool Name | Core Purpose | Key Arguments |
|---|---|---|
| `read-file` | Reads file content from executor workspace folder (`readfile`). | `path: string` |
| `write-file` | Writes file content into executor workspace folder (`writefile`). | `path: string`, `content: string` |
| `delete-file` | Deletes file from workspace folder (`delfile`). | `path: string` |
| `list-files` | Lists directory contents in executor workspace (`listfiles`). | `path: string` |
| `create-folder` | Creates directory in executor workspace (`makefolder`). | `path: string` |
| `load-custom-asset` | Loads local image/audio file into a Roblox `Content` ID (`getcustomasset`). | `file_path: string` |

---

## 4. Canonical Step-by-Step Workflows

### Workflow 1: Inspecting & Decompiling a Client Script
```json
// 1. Find the script path in PlayerScripts or character
{ "name": "find-instances", "arguments": { "class_name": "LocalScript" } }

// 2. Decompile the script to read its source code
{ "name": "get-script", "arguments": { "script_path": "game.Players.LocalPlayer.PlayerScripts.PlayerModule" } }
```

### Workflow 2: Auditing & Triggering RemoteEvents
```json
// 1. Scan for all remotes in ReplicatedStorage
{ "name": "list-remotes", "arguments": {} }

// 2. Install remote spy to log live traffic
{ "name": "spy-remotes", "arguments": { "action": "install" } }

// 3. Fire the remote with verified arguments
{ "name": "fire-remote", "arguments": { "remote_path": "game.ReplicatedStorage.Remotes.BuyItem", "arguments": "[\"Sword\", 1]" } }
```

### Workflow 3: Teleportation & Player Enhancements
```json
// 1. Enable noclip, infinite jump, and increase speed
{ "name": "set-player", "arguments": { "property_map": { "WalkSpeed": 60, "Noclip": true, "InfiniteJump": true } } }

// 2. Teleport to target part or player
{ "name": "teleport", "arguments": { "target_part": "workspace.Map.Checkpoints.Stage5" } }
```

### Workflow 4: Visual Capture & Telemetry
```json
// 1. Capture full window screenshot
{ "name": "take-screenshot", "arguments": { "pid": 14388 } }

// 2. Record 60 FPS video clip of in-game action
{ "name": "record-roblox-video", "arguments": { "duration_seconds": 10, "fps": 60, "pid": 14388 } }
```

---

## 5. Best Practices for AI Agents

1. **Be Non-Destructive**: Before deleting or modifying instances, use `read-properties` or `resolve-path` to verify the target.
2. **Handle Nil Returns Gracefully**: If an executor lacks `decompile()`, `get-script` automatically falls back to raw bytecode size.
3. **Use PID When Multiple Windows Exist**: If multiple Roblox windows are open, query `list-roblox-processes` first and supply `pid` in subsequent tool calls.
4. **Prefer High-Level Tools**: Use `teleport` instead of manually calculating CFrame math, and use `set-player` instead of writing custom Luau loops.
