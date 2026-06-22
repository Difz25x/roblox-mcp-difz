# roblox-mcp-difz

**Universal MCP (Model Context Protocol) server for Roblox game control, reverse engineering, network interception, input simulation, and game state manipulation.**

Works with **any MCP-compatible AI client** — Claude Code, Claude Desktop, Cursor, Windsurf, VS Code (Cline/Continue.dev), or a custom MCP integration. 151 tools covering instance traversal, property inspection, remote event/function control, Lua code execution, function hooking, metatable manipulation, network traffic interception, file system operations, input simulation, and more.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [Executor Setup](#executor-setup)
- [MCP Client Configuration](#mcp-client-configuration)
- [Commands](#commands)
- [UNC Capabilities Table](#unc-capabilities-table)
- [Tool Listing by Category](#tool-listing-by-category)
- [Architecture](#architecture)
- [Multi-Instance Support](#multi-instance-support)
- [Troubleshooting](#troubleshooting)
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

### Generic MCP Client

```bash
rblx-mcp setup --ai generic
```

This writes `mcp-config.json` to the current directory. Any MCP client that supports `type: "http"` transport can use:
```
http://localhost:28429/mcp
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

## UNC Capabilities Table

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

## Tool Listing by Category

### Game Metadata & Discovery (8 tools)

| Tool | Description |
|------|-------------|
| `get_game_metadata` | PlaceId, UniverseId, JobId, player count, FPS, memory |
| `game_metadata_collector` | Extended metadata including creator info, server details, membership type |
| `dump_workspace_players` | Real-time data for every player: position, health, team, backpack, proximity prompts |
| `local_player_state_dumper` | Full local player state: account, character, GUI, backpack |
| `get_local_player_data` | LocalPlayer Backpack, Leaderstats, Character, Humanoid, ScreenGuis |
| `get_workspace_objects` | Recursive workspace dump: name, class, position, size, color, attributes |
| `get_console_logs` | LogService output filtered by type (error/warning/info) with timestamps |
| `humanoid_state_extractor` | Detailed Humanoid state: health, walkspeed, jumppower, state type, floor material |
| `cursor_tracker` | Read mouse cursor position, icon, and button state |

### Instance Tree Traversal (13 tools)

| Tool | Description |
|------|-------------|
| `recursive_tree_walker` | Walk instance tree with depth, class, and name filters |
| `service_discoverer` | Enumerate all loaded DataModel services |
| `child_watcher` | Monitor a container for child additions/removals/reorderings |
| `path_resolver` | Resolve dot/slash-delimited paths to instance references |
| `class_subtree_enumerator` | Recursively enumerate all instances of a class and its subclasses |
| `spatial_proximity_scanner` | Find BaseParts within a radius around a world position |
| `nil_realm_scanner` | Find instances parented to nil (hidden/orphaned objects) |
| `get_nil_instances` | Enumerate every instance parented to nil outside the game tree |
| `class_instance_collector` | Collect all instances matching a class name within a scope |
| `data_model_explorer` | Top-down DataModel enumeration with depth control |
| `datamodel_explorer` | Alias for data_model_explorer |
| `sibling_enumerator` | Enumerate siblings of an instance within the same parent |
| `get_instance_from_path` | Resolve any game path string and return instance properties |

### Tags & Attributes (5 tools)

| Tool | Description |
|------|-------------|
| `tag_collector` | Find instances by CollectionService tags (any/all mode) |
| `tag_reader` | Get all CollectionService tags on a specific instance |
| `attribute_seeker` | Search for instances with specific custom attributes |
| `attribute_collector` | Read named custom attributes from an instance |
| `full_attribute_enumerator` | Enumerate ALL custom attributes via GetAllAttributes() |

### Remote Events & Functions (8 tools)

| Tool | Description |
|------|-------------|
| `dump_remote_events` | Scan services for all RemoteEvent/RemoteFunction instances |
| `remote_surface_scanner` | Same as dump_remote_events with search ancestor and class filtering |
| `remote_event_trigger` | Fire a RemoteEvent with typed arguments |
| `remote_function_caller` | Invoke a RemoteFunction and capture the server response |
| `invoke_remote_function` | Alias for remote_function_caller |
| `fire_remote_event` | Fire or invoke a remote with full argument support |
| `remote_connection_inspector` | Inspect all connected handlers on a remote |
| `get_remote_connections` | Alias for remote_connection_inspector |

### Code Execution (2 tools)

| Tool | Description |
|------|-------------|
| `luau_code_executor` | Execute arbitrary Luau code with identity level control |
| `execute_custom_luau` | Execute Luau code in executor environment with full privileges |

### Property Access (9 tools)

| Tool | Description |
|------|-------------|
| `property_bulk_reader` | Batch-read multiple properties from any instance |
| `property_deep_dive` | Deep inspection of a single property including type, security, and defaults |
| `class_blueprint_viewer` | Complete reflection metadata for any Roblox class |
| `string_value_reader` | Read and decode BinaryStringValue / UnicodeStringValue contents |
| `security_metadata_analyzer` | Analyze read/write/replication security on properties |
| `property_mutator_generic` | Set any writable property on any instance |
| `property_value_seeker` | Search tree for instances where a property has a specific value |
| `value_container_scanner` | Scan for ValueBase subclass children |
| `object_value_resolver` | Resolve ObjectValue references and typed value containers |

### Hidden Properties (3 tools)

| Tool | Description |
|------|-------------|
| `hidden_property_reader` | Read non-scriptable properties via gethiddenproperty |
| `hidden_property_writer` | Write non-scriptable properties via sethiddenproperty |
| `property_scriptable_toggler` | Make a non-scriptable property read/write via setscriptable |

### GUI Manipulation (12 tools)

| Tool | Description |
|------|-------------|
| `gui_injector` | Inject custom ScreenGui/BillboardGui/SurfaceGui into CoreGui/PlayerGui |
| `inject_gui` | Alias for gui_injector |
| `screen_overlay_renderer` | Render 2D drawing overlays (lines, circles, text, crosshairs) |
| `viewport_capture_handler` | Capture game viewport as base64 PNG/JPEG screenshot |
| `gui_hierarchy_dumper` | Recursively dump CoreGui tree with positions, sizes, visibility |
| `screen_text_extractor` | Extract rendered text from all visible GUI elements |
| `element_geometry_reader` | Read position, size, and visual properties of GUI elements |
| `notification_hider` | Detect, hide, and suppress in-game notifications and popups |
| `clean_gui_traces` | Hide/destroy/restore executor GUI elements from CoreGui/PlayerGui |
| `gui_button_clicker` | Fire click signals on GUI buttons programmatically |
| `ui_element_clicker` | Click on GUI elements by path with absolute positioning |
| `ui_change_watcher` | Monitor GUI for child additions, property changes, and removals |

### File System (6 tools)

| Tool | Description |
|------|-------------|
| `file_reader` | Read files from executor filesystem via UNC readfile |
| `file_writer` | Write files to executor filesystem via UNC writefile |
| `file_deleter` | Delete files/folders via UNC delfile |
| `file_lister` | List files in a directory via UNC listfiles |
| `folder_creator` | Create folders via UNC makefolder |
| `custom_asset_loader` | Load custom assets via UNC getcustomasset |

### Player State (2 tools)

| Tool | Description |
|------|-------------|
| `modify_local_property` | Modify character properties: WalkSpeed, JumpPower, Health, Noclip, InfiniteJump, Gravity |
| `teleport_to_target` | Instant CFrame teleportation to coordinates, player, instance, or mouse target |

### Input Simulation (11 tools)

| Tool | Description |
|------|-------------|
| `key_press_emitter` | Simulate a single keyboard key press via VirtualInputManager |
| `key_hold_controller` | Hold a key down for a duration or release it |
| `key_combo_simulator` | Simulate chorded key combinations (Ctrl+C, Ctrl+Shift+Esc) |
| `text_automated_typer` | Type text character-by-character with configurable delays |
| `mouse_move_absolute` | Move cursor to absolute screen coordinates with smoothing |
| `mouse_click_simulator` | Simulate mouse button clicks at current or specified position |
| `mouse_button_hold` | Press and hold or release a mouse button |
| `mouse_drag_emitter` | Click-and-drag from start to end position with interpolation |
| `scroll_wheel_simulator` | Simulate mouse scroll wheel in vertical/horizontal directions |
| `touch_input_simulator` | Simulate touch gestures: tap, long-press, swipe, pinch |
| `character_motion_controller` | WASD-based character navigation to waypoints |

### Script & Module Analysis (13 tools)

| Tool | Description |
|------|-------------|
| `get_loaded_modules` | List all loaded ModuleScripts in the registry |
| `module_registry_scanner` | Enumerate cached modules with dependency graphs and source inspection |
| `running_scripts_lister` | List all actively executing scripts |
| `script_source_ripper` | Extract source code from any script at runtime |
| `bytecode_disassembler` | Disassemble Luau bytecode from a loaded closure |
| `runtime_bytecode_patcher` | Patch bytecode instructions in a loaded function |
| `script_decompiler` | Decompile a script via LuaExpert/Medal/Konstant chain |
| `script_closure_getter` | Get the main closure of a script via getscriptclosure |
| `script_hash_calculator` | Compute script hash via getscripthash |
| `calling_script_finder` | Get the script that called the current context |
| `script_environment_dumper` | Dump a script's local environment (getsenv) |
| `roblox_environment_viewer` | Read and compare getrenv and getgenv globals |
| `sandbox_analyzer` | Analyze sandbox restrictions, identity level, and anti-tamper measures |

### Closure Analysis (5 tools)

| Tool | Description |
|------|-------------|
| `closure_type_checker` | Check if a closure is C/Lua/executor with iscclosure/islclosure/isexecutorclosure |
| `closure_inspector` | Dump prototype tree, constants, upvalues, and debug info |
| `closure_upvalue_editor` | Read/modify upvalues on any loaded closure |
| `dump_constants_and_upvalues` | Inspect constants and upvalues of a function |
| `debug_info_extractor` | Extract comprehensive debug info: source, line numbers, upvalues, locals |

### Metatable Manipulation (4 tools)

| Tool | Description |
|------|-------------|
| `metatable_seer` | Inspect metatables including hidden/locked ones |
| `metatable_modifier` | Set/replace/remove metamethods on any object |
| `raw_metatable_setter` | Set raw metatable bypassing __metatable protection |
| `readonly_toggler` | Toggle table readonly state via setreadonly/isreadonly |

### Function Hooking (4 tools)

| Tool | Description |
|------|-------------|
| `function_interceptor_installer` | Install pre/post/replace hooks on global/instance functions |
| `function_interceptor_remover` | Remove a previously installed hook with safe restoration |
| `function_hook_installer` | Hook any Lua function using hookfunction |
| `namecall_spy` | Monitor namecall method invocations on a target object |

### Registry & GC Scanning (3 tools)

| Tool | Description |
|------|-------------|
| `registry_scanner` | Scan the Lua registry table with key pattern and type filtering |
| `registry_reader` | Dump registry keyed by index |
| `gc_scanner` | Scan garbage collector for functions, tables, threads |

### Network Traffic Interception (9 tools)

| Tool | Description |
|------|-------------|
| `spy_remote_traffic` | Hook FireServer/InvokeServer on all remotes and capture traffic |
| `traffic_interceptor_installer` | Install a global remote traffic interceptor with session management |
| `traffic_interceptor_remover` | Remove a traffic interceptor by session ID |
| `remote_blocker_installer` | Block specific remotes from sending to the server |
| `remote_killswitch_toggler` | Global killswitch for ALL outgoing remote traffic |
| `argument_spoofer` | Intercept and modify arguments before they reach the server |
| `argument_type_analyzer` | Probe a remote's expected argument types and handler signatures |
| `traffic_filter_setter` | Configure include/exclude filters for traffic interception |
| `response_interceptor` | Hook RemoteFunction return values and modify server responses |

### Network Ownership (3 tools)

| Tool | Description |
|------|-------------|
| `get_network_ownership` | Analyze which parts are client-owned vs server-owned |
| `network_ownership_mapper` | Map network ownership across a container with filtering |
| `replication_filter_checker` | Analyze server ReplicationFilter for hidden objects/properties |

### Instance Lifecycle (8 tools)

| Tool | Description |
|------|-------------|
| `instance_factory` | Create new instances of any Roblox class |
| `instance_terminator` | Destroy or remove instances from the hierarchy |
| `instance_duplicator` | Clone instances with position offset and renaming |
| `instance_comparer` | Compare two instances for reference equality |
| `fire_click_detector` | Fire a ClickDetector without physical clicking |
| `fire_proximity_prompt` | Fire a ProximityPrompt bypassing HoldDuration/range |
| `interact_all_proximity_prompts` | Trigger every ProximityPrompt in range |
| `signal_replicator` | Replicate a signal/event via replicatesignal |

### Camera & Viewport (3 tools)

| Tool | Description |
|------|-------------|
| `camera_state_reader` | Read camera CFrame, Focus, FOV, CameraType, viewport |
| `camera_controller` | Lock/unlock/orbit/zoom camera with smooth transitions |
| `world_to_screen_converter` | Convert 3D world coordinates to 2D screen coordinates |

### Visual Overlays (2 tools)

| Tool | Description |
|------|-------------|
| `esp_label_manager` | Create/update/destroy ESP text labels attached to players/NPCs/objects |
| `billboard_attachment_manager` | BillboardGui attachments floating above characters or parts |

### Lighting & Environment (7 tools)

| Tool | Description |
|------|-------------|
| `lighting_configurator` | Modify Lighting: brightness, clock time, fog, ambient, shadows, technology |
| `atmosphere_tweaker` | Control Atmosphere density, glare, haze, color, decay |
| `cloud_fog_controller` | Control cloud settings, FogService, and depth fog |
| `terrain_brush_controller` | Fill/replace/read terrain voxels and materials |
| `physics_engine_tuner` | Modify workspace physics: gravity, collision, streaming |
| `material_override_tool` | Override part materials, physical properties, and MaterialVariants |
| `sound_effect_manager` | Play, stop, and control 3D sound effects |

### Character & Social (4 tools)

| Tool | Description |
|------|-------------|
| `character_appearance_modifier` | Modify character appearance, body scale, skin tone, model swap |
| `spawn_location_manager` | Manage spawn locations, respawn behavior, and teleportation |
| `chat_system_controller` | Control chat: modify chat properties, send system messages, bypass filter |
| `team_color_manager` | Manage teams, team colors, player assignments, auto-assign |

### Utilities (3 tools)

| Tool | Description |
|------|-------------|
| `check_unc_capabilities` | Test executor for all supported UNC functions and report support matrix |
| `macro_recorder` | Record mouse and keyboard input sequences into named macros |
| `macro_replayer` | Replay recorded macros with speed control and looping |

### Server-Side Tools (5 tools)

These tools execute on the Node.js server directly without requiring a Roblox executor.

| Tool | Description |
|------|-------------|
| `get_roblox_processes` | List all running RobloxPlayerBeta processes on this machine |
| `launch_roblox` | Launch the Roblox client application |
| `open_game` | Open a Roblox game via roblox-player protocol |
| `capture_roblox_screenshot` | Take a screenshot of a Roblox window by PID |
| `get_roblox_versions` | List installed Roblox version directories |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        AI Client                                  │
│  (Claude Code / Claude Desktop / Cursor / Windsurf / Cline /     │
│   Continue.dev / any MCP-compatible client)                      │
└─────────────────────────┬────────────────────────────────────────┘
                          │ MCP JSON-RPC 2.0 (HTTP POST /mcp)
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Node.js MCP Server (:28429)                    │
│                                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────┐  │
│  │ MCP Handler  │  │ Queue Manager│  │ WebSocket Server (WS)   │  │
│  │ (JSON-RPC)   │──│ (Task Queue) │──│ /ws                     │  │
│  └─────────────┘  └──────────────┘  └───────────┬─────────────┘  │
│                                                  │                │
│  ┌─────────────┐  ┌──────────────┐               │                │
│  │Tool Defs    │  │Session Mgr   │               │                │
│  │(151 tools)  │  │(workers)     │               │                │
│  └─────────────┘  └──────────────┘               │                │
│                                                  │                │
│  ┌──────────────────────────────────────────────┐│                │
│  │ Server-Side Tools (Process Manager)          ││                │
│  │ get_roblox_processes, launch_roblox,          ││                │
│  │ open_game, capture_roblox_screenshot,         ││                │
│  │ get_roblox_versions                           ││                │
│  └──────────────────────────────────────────────┘│                │
└──────────────────────────────────────────────────┼────────────────┘
                                                   │ WebSocket
                                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                  Roblox Executor (mcp.lua)                        │
│                                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────┐  │
│  │ WS Client    │  │ Task Router   │  │ Handler Registry        │  │
│  │ (connect)    │──│ (wsPoll)     │──│ (150+ handlers)         │  │
│  └─────────────┘  └──────────────┘  └─────────────────────────┘  │
│                                           │                       │
│  ┌────────────────────────────────────────┘                       │
│  │  UNC Compatibility Layer                                       │
│  │  (getnilinstances, hookfunction, loadstring, getreg,           │
│  │   getgc, getconnections, firesignal, readfile, writefile,      │
│  │   gethiddenproperty, sethiddenproperty, getrawmetatable, ...)  │
│  └────────────────────────────────────────────────────────────────┘
│                                                                   │
│                     Roblox DataModel                              │
│  (Players, Workspace, Lighting, ReplicatedStorage, CoreGui, ...)  │
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

The client script (mcp.lua) includes a comprehensive compatibility layer that adapts to the executor's available UNC functions. Every function has a fallback strategy:

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

## Troubleshooting

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
