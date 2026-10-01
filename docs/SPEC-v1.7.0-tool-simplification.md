# Technical Specification: Roblox MCP v1.7.0 — Simplified Tools Architecture

## 1. Tool Taxonomy & Category Architecture (~65 Core Tools)

All remaining tools are categorized into 10 clear, logical domains:

### 1. Player & Character (6 tools)
- `get-player` (alias: `get-local-player`): Read local player info, character, humanoid, leaderstats, inventory.
- `get-players` (alias: `dump-workspace-players`): List all players in the server, character models, HP, and positions.
- `set-player` (alias: `modify-local-player`): Modify WalkSpeed, JumpPower, HipHeight, Noclip, InfiniteJump.
- `teleport` (alias: `teleport-player`): CFrame teleport to coordinates, player, or instance.
- `bypass-anticheat` (alias: `disable-anticheat`): Prevent client kicks, hook TeleportService, toggle anti-AFK.
- `send-chat`: Send chat message, system message, or bypass text filters.

### 2. Network & Remotes (5 tools)
- `list-remotes` (alias: `dump-remote-events`): Scan game for all RemoteEvents and RemoteFunctions.
- `fire-remote`: Call FireServer on RemoteEvent or InvokeServer on RemoteFunction.
- `spy-remotes`: Unified RPC surveillance, blocking, killswitch, and argument spoofing.
- `get-remote-handlers` (alias: `inspect-remote-connections`): List active listeners/connections on a remote.
- `fire-signal`: Fire RBXScriptSignal on an instance (MouseButton1Click, Activated, etc.).

### 3. DataModel & Instances (10 tools)
- `find-instances` (alias: `get-instances-by-class`): Search game tree by ClassName, with optional name filter and depth.
- `walk-tree`: Full breadth/depth tree search by regex or glob name pattern.
- `resolve-path` (alias: `get-instance`): Convert dot/slash string path into an actual object reference.
- `get-children`: Inspect children of an instance, or monitor child addition/removal.
- `find-by-property`: Search instances matching a property value (e.g. Material='Neon').
- `find-by-tag`: Find instances tagged with CollectionService tags.
- `find-by-attribute`: Find instances with custom attributes.
- `scan-proximity`: Find 3D objects within radius of coordinates.
- `scan-nil-instances`: Find instances parented to nil (orphaned/hidden instances).
- `get-services`: List active core Roblox services (Workspace, Players, Lighting, etc.).

### 4. Properties & Manipulation (5 tools)
- `read-properties`: Read multiple properties from an instance simultaneously.
- `set-properties`: Write one or more properties on a target instance.
- `create-instance`: Instantiate a new Roblox class and parent it.
- `clone-instance`: Duplicate an instance and optionally offset position.
- `destroy-instance`: Remove or reparent instance to nil.

### 5. GUI & Screen (7 tools)
- `get-gui-tree` (alias: `dump-gui-hierarchy`): Dump hierarchy of CoreGui or PlayerGui.
- `get-screen-text` (alias: `extract-screen-text`): OCR-like text extraction from visible GUI elements.
- `click-button`: Simulate click on a GuiButton (Activated, MouseButton1Click).
- `inject-gui`: Inject custom ScreenGui or BillboardGui into the viewport.
- `manage-esp`: Create/update 3D world text labels above players or objects.
- `world-to-screen`: Project 3D world coordinates into 2D screen pixels.
- `hide-notifications`: Suppress or hide in-game modal popups and toasts.

### 6. Input Simulation (8 tools)
- `move-character`: Automate WASD navigation to world coordinates with pathing.
- `move-mouse`: Move mouse cursor to screen X, Y coordinates.
- `click-mouse`: Perform left, right, or middle mouse button click.
- `hold-mouse`: Hold down or release a mouse button for dragging.
- `scroll-mouse`: Simulate mouse wheel scroll.
- `press-key`: Press and release a keyboard key by KeyCode.
- `hold-key`: Press and hold a keyboard key for a duration.
- `type-text`: Type string character-by-character with realistic intervals.
- `control-camera`: Lock, orbit, or tween the viewport camera.
- `interact-prompts`: Trigger all ProximityPrompts or ClickDetectors in range.

### 7. Scripting & Execution (8 tools)
- `execute-script`: Execute arbitrary Luau code string or file in target executor.
- `get-script` (alias: `get-script-source`, `decompile-script`): Read decompiled Luau source or raw bytecode.
- `get-loaded-modules`: List all ModuleScripts currently in memory.
- `get-running-scripts`: List actively executing LocalScripts and Scripts.
- `get-script-env` (alias: `getsenv`): Read a script's local environment variables.
- `get-roblox-env` (alias: `getrenv`): Inspect the global Roblox environment.
- `analyze-sandbox`: Profile current executor identity level and restrictions.
- `check-unc`: Test which UNC functions are supported by the executor.

### 8. Metatables & Low-Level (6 tools)
- `inspect-metatable`: Read metamethods of an instance or table.
- `modify-metatable`: Add, replace, or delete metamethods on an object.
- `toggle-readonly`: Set a table writable or read-only.
- `hook-function`: Detour a global function or instance method.
- `inspect-closure` (alias: `get-constants-upvalues`): Dump upvalues, constants, and prototypes.
- `get-debug-info`: Extract debug info (source, line, params) from a closure.
- `scan-gc`: Enumerate objects in Lua garbage collector.

### 9. Filesystem (5 tools)
- `read-file`: Read file from executor workspace folder.
- `write-file`: Write text to file in executor workspace.
- `delete-file`: Delete file or folder in executor workspace.
- `list-files`: List files and folders in executor workspace.
- `create-folder`: Create folder in executor workspace.

### 10. Server & Transport Management (8 tools)
- `list-roblox-processes`: List OS Roblox processes with connection status table.
- `launch-roblox`: Launch Roblox Player executable.
- `open-roblox-game`: Join a Roblox place or private server link.
- `take-screenshot`: Capture window screenshot of Roblox by PID or workerId.
- `record-roblox-video`: Capture 30fps MP4 video of Roblox window.
- `get-transport-status`: View active transport mode, workers, and process status.
- `set-transport-mode`: Switch transport between 'auto', 'ws', and 'stream'.
- `set-autoexecute`: Toggle autoexecute across teleports via queue_on_teleport.

---

## 2. Universal Schema Rule: `workerId`
In `src/tool-definitions.ts`, every tool definition:
1. Puts `workerId` as the **first property** in `properties`:
```typescript
properties: {
    workerId: {
        type: "string",
        description: "Target Roblox session ID, player name, or PID. Optional — if omitted, executes across ALL connected game sessions."
    },
    ...otherProperties
}
```
2. `required` array NEVER contains `"workerId"`.
3. If omitted or empty string, `src/mcp-handler.ts` executes the tool across all active game clients and aggregates results.
