interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

const ALIAS_MAP: Record<string, string> = {
    'get-local-player': 'get-player',
    'dump-workspace-players': 'get-players',
    'dump-remote-events': 'list-remotes',
    'dump-gui-hierarchy': 'get-gui-tree',
    'extract-screen-text': 'get-screen-text',
    'get-script-source': 'get-script',
    'decompile-script': 'get-script',
    'inspect-remote-connections': 'get-remote-handlers',
    'modify-local-player': 'set-player',
    'teleport-player': 'teleport',
    'disable-anticheat': 'bypass-anticheat',
    'get-instances-by-class': 'find-instances',
    'get-instances-by-subclass': 'find-instances',
    'get-instance': 'resolve-path',
    'click-ui-element': 'click-button',
    'inspect-property': 'read-properties',
    'set-raw-metatable': 'modify-metatable',
    'get-constants-upvalues': 'inspect-closure',
    'execute-file': 'execute-script',
    'install-remote-spy': 'spy-remotes',
    'block-remote': 'spy-remotes',
    'toggle-remote-killswitch': 'spy-remotes',
    'spoof-remote-args': 'spy-remotes',
    'set-remote-filter': 'spy-remotes',
    'simulate-touch': 'move-mouse',
    'get-siblings': 'get-children',
    'get-workspace-objects': 'walk-tree',
    'hold-mouse-button': 'hold-mouse',
};

class ToolDefinitions {
    private tools: ToolDefinition[];

    constructor() {
        const SERVER_SIDE_ONLY = new Set([
            'list-roblox-processes',
            'launch-roblox',
            'open-roblox-game',
            'take-screenshot',
            'record-roblox-video',
            'get-transport-status',
            'set-transport-mode',
        ]);

        this.tools = this._defineTools().map(tool => {
            const schema: any = tool.inputSchema || { type: 'object', properties: {} };
            const existing = schema.properties || {};
            delete existing.workerId;
            delete existing.worker_id;

            // Make workerId the FIRST universal argument across all tools
            const newProperties: Record<string, any> = {
                workerId: {
                    type: 'string',
                    description: 'Target Roblox session ID, player name, or PID. Optional — if omitted, executes across ALL connected game sessions.',
                },
                ...existing,
            };

            if (!SERVER_SIDE_ONLY.has(tool.name) && !newProperties.pid) {
                newProperties.pid = {
                    type: 'number',
                    description: 'Optional target Roblox process ID (PID).',
                };
            }

            schema.properties = newProperties;
            tool.inputSchema = this._sanitizeSchema(schema);
            return tool;
        });
    }

    private _sanitizeSchema(schema: any): any {
        const sanitize = (obj: any): any => {
            if (!obj || typeof obj !== 'object') return obj;

            if (Array.isArray(obj)) {
                return obj.map(item => sanitize(item));
            }

            if (typeof obj.type === 'string') {
                obj.type = obj.type.toLowerCase();
            }

            delete obj.default;
            delete obj.oneOf;
            delete obj.anyOf;

            for (const key in obj) {
                if (typeof obj[key] === 'object') {
                    obj[key] = sanitize(obj[key]);
                }
            }

            return obj;
        };

        if (!schema.type) schema.type = 'object';
        if (!schema.properties) schema.properties = {};

        return sanitize(schema);
    }

    getTools(): ToolDefinition[] {
        return this.tools;
    }

    getTool(name: string): ToolDefinition | undefined {
        const direct = this.tools.find(t => t.name === name);
        if (direct) return direct;
        const target = ALIAS_MAP[name];
        if (target) {
            return this.tools.find(t => t.name === target);
        }
        return undefined;
    }

    get count(): number {
        return this.tools.length;
    }

    private _defineTools(): ToolDefinition[] {
        return [
            // ==================== 1. PLAYER & CHARACTER ====================
            {
                name: "get-player",
                description: "Get local player character details, health, walkspeed, leaderstats, and backpack inventory.",
                inputSchema: {
                    type: "object",
                    properties: {
                        include_backpack: { type: "boolean", description: "Include items in player backpack." },
                        include_character: { type: "boolean", description: "Include character and humanoid state." },
                        include_leaderstats: { type: "boolean", description: "Include leaderstats values (money, level, etc.)." }
                    }
                }
            },
            {
                name: "get-players",
                description: "List all active players in the server with their character models, HP, speed, and positions.",
                inputSchema: {
                    type: "object",
                    properties: {
                        include_character_humanoid: { type: "boolean", description: "Include detailed Humanoid state (Health, WalkSpeed)." },
                        include_backpack: { type: "boolean", description: "Include backpack contents for each player." }
                    }
                }
            },
            {
                name: "set-player",
                description: "Instantly modify local player properties: WalkSpeed, JumpPower, HipHeight, Health, Noclip, or InfiniteJump.",
                inputSchema: {
                    type: "object",
                    properties: {
                        property_map: { type: "string", description: "JSON string of properties (e.g. '{\"WalkSpeed\":50,\"Noclip\":true}')." },
                        duration: { type: "number", description: "Duration in seconds before reverting (0 = permanent)." }
                    }
                }
            },
            {
                name: "teleport",
                description: "Instant CFrame teleportation to 3D world coordinates, a named player, or a workspace instance.",
                inputSchema: {
                    type: "object",
                    properties: {
                        target_type: { type: "string", enum: ["coordinates", "player", "instance", "mouse"], description: "Type of teleport target." },
                        target_name: { type: "string", description: "Name of target player or instance." },
                        coordinates: {
                            type: "object",
                            properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
                            description: "Target coordinates for coordinate-based teleport."
                        }
                    },
                    required: ["target_type"]
                }
            },
            {
                name: "bypass-anticheat",
                description: "Configure client session stability, prevent idle AFK disconnections, and handle reconnects.",
                inputSchema: {
                    type: "object",
                    properties: {
                        hook_kick: { type: "boolean", description: "Prevent unexpected client disconnect dialogs during testing sessions." },
                        block_teleport: { type: "boolean", description: "Prevent unexpected server teleports during debugging sessions." },
                        anti_afk: { type: "boolean", description: "Enable background activity loop to prevent 20-minute idle disconnect." }
                    }
                }
            },
            {
                name: "send-chat",
                description: "Send in-game chat messages, broadcast system notices, or toggle bubble chat.",
                inputSchema: {
                    type: "object",
                    properties: {
                        action: { type: "string", enum: ["send_system_message", "bypass_filter", "set_bubble_chat", "disable_chat", "enable_chat"], description: "Chat action to execute." },
                        message_text: { type: "string", description: "Text content of the message." },
                        message_color: { type: "string", description: "Optional Color3 override for the message." }
                    },
                    required: ["action"]
                }
            },
            {
                name: "get-humanoid-state",
                description: "Retrieve health, walkspeed, jump power, and rig state from a Humanoid instance.",
                inputSchema: {
                    type: "object",
                    properties: {
                        humanoid_path: { type: "string", description: "Path to the Humanoid instance (e.g. 'workspace.Character.Humanoid')." }
                    },
                    required: ["humanoid_path"]
                }
            },

            // ==================== 2. NETWORKING & REMOTES ====================
            {
                name: "list-remotes",
                description: "Scan game containers for all RemoteEvents, RemoteFunctions, and UnreliableRemoteEvents.",
                inputSchema: {
                    type: "object",
                    properties: {
                        search_paths: { type: "array", items: { type: "string" }, description: "Paths to search (defaults to ReplicatedStorage and Workspace)." }
                    }
                }
            },
            {
                name: "fire-remote",
                description: "Fire a RemoteEvent (FireServer) or invoke a RemoteFunction (InvokeServer) with arguments.",
                inputSchema: {
                    type: "object",
                    properties: {
                        remote_path: { type: "string", description: "Full hierarchical path to the Remote instance." },
                        arguments: { type: "string", description: "JSON string of arguments array (e.g. '[\"test\", 42, true]')." },
                        timeout: { type: "number", description: "Timeout in seconds to wait for server response." }
                    },
                    required: ["remote_path"]
                }
            },
            {
                name: "spy-remotes",
                description: "Inspect, log, and filter RemoteEvent and RemoteFunction network traffic.",
                inputSchema: {
                    type: "object",
                    properties: {
                        action: { type: "string", enum: ["install", "get_log", "clear", "block", "unblock", "ignore", "unignore", "remove"], description: "Action to perform on remote logger/filter." },
                        remote_paths: { type: "array", items: { type: "string" }, description: "Remote path(s) to filter or monitor." },
                        max_results: { type: "number", description: "Maximum log entries to retrieve." },
                        filter_remote_path: { type: "string", description: "Filter logs by remote name substring." }
                    },
                    required: ["action"]
                }
            },
            {
                name: "get-remote-handlers",
                description: "Inspect all active listeners and connection handlers attached to a RemoteEvent.",
                inputSchema: {
                    type: "object",
                    properties: {
                        remote_path: { type: "string", description: "Full path to the RemoteEvent to inspect." }
                    },
                    required: ["remote_path"]
                }
            },
            {
                name: "fire-signal",
                description: "Fire an RBXScriptSignal on an instance using firesignal (e.g. MouseButton1Click, Activated).",
                inputSchema: {
                    type: "object",
                    properties: {
                        signal_path: { type: "string", description: "Full path to the GuiButton or instance signal." }
                    },
                    required: ["signal_path"]
                }
            },
            {
                name: "check-replication",
                description: "Inspect server-to-client replication filter rules to see which objects and properties are filtered.",
                inputSchema: {
                    type: "object",
                    properties: {
                        container_filter: { type: "string", description: "Container scope (e.g. 'game.Workspace')." }
                    }
                }
            },

            // ==================== 3. DATAMODEL & INSTANCES ====================
            {
                name: "find-instances",
                description: "Find instances across the game tree by ClassName, with optional name filter and depth.",
                inputSchema: {
                    type: "object",
                    properties: {
                        class_name: { type: "string", description: "Roblox ClassName to search for (e.g. 'Part', 'Model', 'LocalScript')." },
                        scope: { type: "string", description: "Root instance path to search from (defaults to 'game')." },
                        max_results: { type: "number", description: "Maximum matching instances to return." }
                    },
                    required: ["class_name"]
                }
            },
            {
                name: "walk-tree",
                description: "Traverse the instance tree matching instance names by regex or glob pattern.",
                inputSchema: {
                    type: "object",
                    properties: {
                        name_pattern: { type: "string", description: "Glob or regex pattern to match names against (e.g. 'Door*', '^Enemy')." },
                        start_path: { type: "string", description: "Root instance path (defaults to 'game')." },
                        max_depth: { type: "number", description: "Maximum recursion depth." }
                    }
                }
            },
            {
                name: "resolve-path",
                description: "Resolve a string path (e.g. 'workspace.Model.Part') into its verified instance details.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Full game path string to resolve." }
                    },
                    required: ["path"]
                }
            },
            {
                name: "get-children",
                description: "List direct children of an instance, or monitor child additions and removals over time.",
                inputSchema: {
                    type: "object",
                    properties: {
                        target_path: { type: "string", description: "Path to instance whose children should be inspected." },
                        duration_ms: { type: "number", description: "Milliseconds to watch for added/removed children." }
                    },
                    required: ["target_path"]
                }
            },
            {
                name: "find-by-property",
                description: "Search the instance tree for objects matching a specific property value (e.g. Material='Neon').",
                inputSchema: {
                    type: "object",
                    properties: {
                        property_name: { type: "string", description: "Property name to check (e.g. 'Transparency', 'Material')." },
                        property_value: { type: "string", description: "Target property value to match." },
                        scope: { type: "string", description: "Root path to constrain search." }
                    },
                    required: ["property_name", "property_value"]
                }
            },
            {
                name: "find-by-tag",
                description: "Find all instances tagged with one or more CollectionService tags.",
                inputSchema: {
                    type: "object",
                    properties: {
                        tags: { type: "array", items: { type: "string" }, description: "List of CollectionService tags to match." }
                    },
                    required: ["tags"]
                }
            },
            {
                name: "find-by-attribute",
                description: "Find instances that have specific custom attributes set via SetAttribute.",
                inputSchema: {
                    type: "object",
                    properties: {
                        attribute_name: { type: "string", description: "Attribute name to search for." },
                        scope: { type: "string", description: "Root path to search from." }
                    },
                    required: ["attribute_name"]
                }
            },
            {
                name: "scan-proximity",
                description: "Find 3D world objects within a radius of specified spatial coordinates.",
                inputSchema: {
                    type: "object",
                    properties: {
                        position: {
                            type: "object",
                            properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
                            description: "3D coordinates origin."
                        },
                        radius: { type: "number", description: "Search radius in studs." },
                        class_filter: { type: "string", description: "Optional class filter (e.g. 'Part,Model')." }
                    },
                    required: ["position", "radius"]
                }
            },
            {
                name: "scan-nil-instances",
                description: "Scan for hidden, cached, or orphaned instances parented to nil.",
                inputSchema: {
                    type: "object",
                    properties: {
                        class_filter: { type: "string", description: "Only return instances matching this ClassName." },
                        max_results: { type: "number", description: "Maximum instances to return." }
                    }
                }
            },
            {
                name: "get-services",
                description: "List all active core Roblox services (Workspace, Players, Lighting, ReplicatedStorage, etc.).",
                inputSchema: {
                    type: "object",
                    properties: {
                        include_children: { type: "boolean", description: "Include direct children of each service." }
                    }
                }
            },
            {
                name: "compare-instances",
                description: "Check if two instance references point to the same underlying C++ game object.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path_a: { type: "string", description: "First instance path." },
                        path_b: { type: "string", description: "Second instance path." }
                    },
                    required: ["path_a", "path_b"]
                }
            },

            // ==================== 4. PROPERTIES & LIFECYCLE ====================
            {
                name: "read-properties",
                description: "Read multiple properties from an instance simultaneously by name.",
                inputSchema: {
                    type: "object",
                    properties: {
                        instance_path: { type: "string", description: "Path to target instance." },
                        property_list: { type: "array", items: { type: "string" }, description: "Array of property names to read." }
                    },
                    required: ["instance_path"]
                }
            },
            {
                name: "set-properties",
                description: "Write one or more properties on a target game instance.",
                inputSchema: {
                    type: "object",
                    properties: {
                        target_path: { type: "string", description: "Path to target instance." },
                        property_map: { type: "string", description: "JSON string of property values (e.g. '{\"Transparency\":0.5}')." }
                    },
                    required: ["target_path"]
                }
            },
            {
                name: "create-instance",
                description: "Create a new Instance of any class and parent it into the game tree.",
                inputSchema: {
                    type: "object",
                    properties: {
                        class_name: { type: "string", description: "Roblox class name (e.g. 'Part', 'Folder', 'Highlight')." },
                        parent_path: { type: "string", description: "Full path where instance should be parented." },
                        instance_name: { type: "string", description: "Optional custom name for the instance." }
                    },
                    required: ["class_name", "parent_path"]
                }
            },
            {
                name: "clone-instance",
                description: "Duplicate an instance in the game tree with optional CFrame position offset.",
                inputSchema: {
                    type: "object",
                    properties: {
                        source_path: { type: "string", description: "Path to instance to clone." },
                        parent_path: { type: "string", description: "Destination parent path." }
                    },
                    required: ["source_path"]
                }
            },
            {
                name: "destroy-instance",
                description: "Destroy an instance from the game tree or reparent it to nil.",
                inputSchema: {
                    type: "object",
                    properties: {
                        target_paths: { type: "array", items: { type: "string" }, description: "Array of instance paths to destroy." }
                    },
                    required: ["target_paths"]
                }
            },

            // ==================== 5. GUI & SCREEN ====================
            {
                name: "get-gui-tree",
                description: "Dump the visual hierarchy of CoreGui, PlayerGui, or StarterGui.",
                inputSchema: {
                    type: "object",
                    properties: {
                        root_container: { type: "string", enum: ["CoreGui", "PlayerGui", "StarterGui"], description: "Root GUI container." },
                        max_depth: { type: "number", description: "Maximum recursion depth." }
                    }
                }
            },
            {
                name: "get-screen-text",
                description: "Extract text strings from all visible on-screen GUI elements (OCR-like extraction).",
                inputSchema: {
                    type: "object",
                    properties: {
                        only_visible: { type: "boolean", description: "Only extract text from currently visible elements." },
                        pattern_filter: { type: "string", description: "Optional regex to filter extracted text." }
                    }
                }
            },
            {
                name: "click-button",
                description: "Simulate click on a GuiButton by firing Activated and MouseButton1Click signals.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Full path to GuiButton instance." }
                    },
                    required: ["path"]
                }
            },
            {
                name: "inject-gui",
                description: "Create and inject custom ScreenGui, SurfaceGui, or BillboardGui elements into the game.",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "Name for the injected GUI." },
                        gui_type: { type: "string", enum: ["ScreenGui", "BillboardGui", "SurfaceGui"], description: "Type of GUI container." },
                        children: { type: "string", description: "JSON string of child GUI element definitions." }
                    },
                    required: ["name"]
                }
            },
            {
                name: "manage-esp",
                description: "Create, update, or remove 3D world text ESP labels attached above players or objects.",
                inputSchema: {
                    type: "object",
                    properties: {
                        action: { type: "string", enum: ["create", "update", "remove", "remove_all"], description: "ESP operation." },
                        target_identifier: { type: "string", description: "Player name or instance path to attach label to." },
                        label_text: { type: "string", description: "Text content to display on the ESP label." }
                    },
                    required: ["action"]
                }
            },
            {
                name: "world-to-screen",
                description: "Convert 3D world coordinates into 2D screen pixel coordinates using the camera viewport.",
                inputSchema: {
                    type: "object",
                    properties: {
                        world_positions: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
                                required: ["x", "y", "z"]
                            },
                            description: "Array of 3D coordinates to project."
                        }
                    },
                    required: ["world_positions"]
                }
            },
            {
                name: "hide-notifications",
                description: "Scan, hide, or suppress in-game UI popups, toasts, and modal dialogs.",
                inputSchema: {
                    type: "object",
                    properties: {
                        action: { type: "string", enum: ["scan", "hide", "show", "destroy"], description: "Action to perform." }
                    },
                    required: ["action"]
                }
            },

            // ==================== 6. INPUT SIMULATION ====================
            {
                name: "move-character",
                description: "Navigate character to 3D world coordinates by simulating WASD directional key inputs.",
                inputSchema: {
                    type: "object",
                    properties: {
                        target_x: { type: "number", description: "Target world X coordinate." },
                        target_z: { type: "number", description: "Target world Z coordinate." },
                        sprint: { type: "boolean", description: "Hold Shift to sprint while moving." }
                    },
                    required: ["target_x", "target_z"]
                }
            },
            {
                name: "move-mouse",
                description: "Move mouse cursor to absolute primary monitor screen coordinates (X, Y).",
                inputSchema: {
                    type: "object",
                    properties: {
                        x: { type: "number", description: "Target screen X pixel coordinate." },
                        y: { type: "number", description: "Target screen Y pixel coordinate." }
                    },
                    required: ["x", "y"]
                }
            },
            {
                name: "click-mouse",
                description: "Simulate a mouse button click (down and up) at the current or specified cursor position.",
                inputSchema: {
                    type: "object",
                    properties: {
                        button: { type: "string", enum: ["LeftButton", "RightButton", "MiddleButton"], description: "Mouse button to click." },
                        x: { type: "number", description: "Optional screen X position before clicking." },
                        y: { type: "number", description: "Optional screen Y position before clicking." }
                    }
                }
            },
            {
                name: "hold-mouse",
                description: "Press and hold down or release a mouse button for drag and drop operations.",
                inputSchema: {
                    type: "object",
                    properties: {
                        action: { type: "string", enum: ["down", "up"], description: "Press down or release up." },
                        button: { type: "string", enum: ["LeftButton", "RightButton", "MiddleButton"], description: "Mouse button." }
                    },
                    required: ["action"]
                }
            },
            {
                name: "scroll-mouse",
                description: "Simulate mouse scroll wheel ticks vertically or horizontally.",
                inputSchema: {
                    type: "object",
                    properties: {
                        delta: { type: "number", description: "Scroll ticks (positive = up, negative = down)." }
                    },
                    required: ["delta"]
                }
            },
            {
                name: "press-key",
                description: "Press and release a keyboard key identified by its KeyCode (e.g. 'Space', 'E', 'F1').",
                inputSchema: {
                    type: "object",
                    properties: {
                        key_code: { type: "string", description: "Roblox KeyCode enum string (e.g. 'Space', 'E', 'Q')." }
                    },
                    required: ["key_code"]
                }
            },
            {
                name: "hold-key",
                description: "Hold down a keyboard key for a specific duration in milliseconds and release.",
                inputSchema: {
                    type: "object",
                    properties: {
                        key_code: { type: "string", description: "Roblox KeyCode enum string." },
                        duration_ms: { type: "number", description: "Duration in milliseconds to hold." }
                    },
                    required: ["key_code"]
                }
            },
            {
                name: "type-text",
                description: "Type a string of text simulating natural human keyboard intervals and optional Enter key.",
                inputSchema: {
                    type: "object",
                    properties: {
                        text: { type: "string", description: "Text string to type." },
                        press_enter_after: { type: "boolean", description: "Press Enter key after typing." }
                    },
                    required: ["text"]
                }
            },
            {
                name: "control-camera",
                description: "Lock camera to a target, orbit around a position, zoom, or set CFrame and FOV.",
                inputSchema: {
                    type: "object",
                    properties: {
                        action: { type: "string", enum: ["lock", "unlock", "set_cframe", "set_fov", "first_person", "third_person"], description: "Camera action." },
                        target_fov: { type: "number", description: "Field of View in degrees." }
                    },
                    required: ["action"]
                }
            },
            {
                name: "interact-prompts",
                description: "Trigger all ProximityPrompts or ClickDetectors in range instantly ignoring hold durations.",
                inputSchema: {
                    type: "object",
                    properties: {
                        range: { type: "number", description: "Maximum search radius in studs." }
                    }
                }
            },

            // ==================== 7. SCRIPTING & BYTECODE ====================
            {
                name: "execute-script",
                description: "Execute Luau script code string or local script file in the Roblox environment.",
                inputSchema: {
                    type: "object",
                    properties: {
                        code: { type: "string", description: "Luau source code string to execute." },
                        file: { type: "string", description: "Optional local file path to load and execute code from." },
                        async: { type: "boolean", description: "Execute code on a separate coroutine." }
                    }
                }
            },
            {
                name: "get-script",
                description: "Retrieve decompiled Luau source code or compiled bytecode of a script.",
                inputSchema: {
                    type: "object",
                    properties: {
                        target_path: { type: "string", description: "Path to Script or ModuleScript." }
                    },
                    required: ["target_path"]
                }
            },
            {
                name: "get-loaded-modules",
                description: "List all ModuleScripts currently cached in the Lua VM module registry.",
                inputSchema: {
                    type: "object",
                    properties: {
                        filter_by_name: { type: "string", description: "Filter modules by name substring." }
                    }
                }
            },
            {
                name: "get-running-scripts",
                description: "List actively executing Scripts and LocalScripts using getrunningscripts.",
                inputSchema: {
                    type: "object",
                    properties: {
                        max_scripts: { type: "number", description: "Maximum scripts to return." }
                    }
                }
            },
            {
                name: "get-script-env",
                description: "Dump a script's local environment variables and internal functions using getsenv.",
                inputSchema: {
                    type: "object",
                    properties: {
                        script_path: { type: "string", description: "Path to Script or ModuleScript." }
                    },
                    required: ["script_path"]
                }
            },
            {
                name: "get-roblox-env",
                description: "Inspect the global Roblox environment (getrenv) and executor globals (getgenv).",
                inputSchema: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "analyze-sandbox",
                description: "Profile executor identity level, security restrictions, and available debug capabilities.",
                inputSchema: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "check-unc",
                description: "Check which Universal Naming Convention (UNC) functions are supported by the connected executor.",
                inputSchema: {
                    type: "object",
                    properties: {}
                }
            },

            // ==================== 8. METATABLES & LOW-LEVEL ====================
            {
                name: "inspect-metatable",
                description: "Inspect metatable metamethods (__index, __newindex, __namecall) of an object.",
                inputSchema: {
                    type: "object",
                    properties: {
                        target_path: { type: "string", description: "Instance path or table reference." }
                    },
                    required: ["target_path"]
                }
            },
            {
                name: "modify-metatable",
                description: "Set, replace, or delete metamethods on an object's metatable.",
                inputSchema: {
                    type: "object",
                    properties: {
                        target_path: { type: "string", description: "Path to instance or table." },
                        action: { type: "string", enum: ["set_readonly", "set_raw"], description: "Metatable operation." },
                        state: { type: "boolean", description: "Readonly state for set_readonly action." }
                    },
                    required: ["target_path"]
                }
            },
            {
                name: "toggle-readonly",
                description: "Toggle the readonly flag of a table or metatable using setreadonly.",
                inputSchema: {
                    type: "object",
                    properties: {
                        target_path: { type: "string", description: "Path to target table." },
                        state: { type: "boolean", description: "True = make readonly, false = make writable." }
                    },
                    required: ["target_path", "state"]
                }
            },
            {
                name: "hook-function",
                description: "Instrument or detour a Luau function or method with custom callback logic for telemetry.",
                inputSchema: {
                    type: "object",
                    properties: {
                        target: { type: "string", description: "Function descriptor (e.g. 'game:GetService', 'Instance:Clone')." },
                        hook_type: { type: "string", enum: ["pre", "post", "replace"], description: "Hook type." },
                        callback_source: { type: "string", description: "Luau source code for hook callback." }
                    },
                    required: ["target", "hook_type", "callback_source"]
                }
            },
            {
                name: "inspect-closure",
                description: "Dump upvalues, constants, prototypes, and bytecode structure of a Luau function.",
                inputSchema: {
                    type: "object",
                    properties: {
                        function_ref: { type: "string", description: "Path or expression evaluating to function." }
                    },
                    required: ["function_ref"]
                }
            },
            {
                name: "get-debug-info",
                description: "Extract source location, line numbers, and parameter count of a function using debug.info.",
                inputSchema: {
                    type: "object",
                    properties: {
                        function_ref: { type: "string", description: "Path or expression evaluating to function." }
                    },
                    required: ["function_ref"]
                }
            },
            {
                name: "scan-gc",
                description: "Scan Lua garbage collector table (getgc) for functions, tables, and threads.",
                inputSchema: {
                    type: "object",
                    properties: {
                        filter_type: { type: "string", enum: ["all", "function", "table", "thread"], description: "Type of GC objects." },
                        max_results: { type: "number", description: "Maximum objects to return." }
                    }
                }
            },
            {
                name: "scan-registry",
                description: "Scan Lua registry index (getreg) for stored internal Roblox objects and tables.",
                inputSchema: {
                    type: "object",
                    properties: {
                        filter_type: { type: "string", enum: ["all", "function", "table", "userdata"], description: "Registry value type." }
                    }
                }
            },
            {
                name: "get-hidden-property",
                description: "Read a non-scriptable hidden property from an instance using gethiddenproperty.",
                inputSchema: {
                    type: "object",
                    properties: {
                        instance_path: { type: "string", description: "Path to instance." },
                        property: { type: "string", description: "Hidden property name." }
                    },
                    required: ["instance_path", "property"]
                }
            },
            {
                name: "set-hidden-property",
                description: "Write a value to a non-scriptable hidden property using sethiddenproperty.",
                inputSchema: {
                    type: "object",
                    properties: {
                        instance_path: { type: "string", description: "Path to instance." },
                        property: { type: "string", description: "Hidden property name." },
                        value: { description: "Value to write to hidden property." }
                    },
                    required: ["instance_path", "property", "value"]
                }
            },

            // ==================== 9. FILESYSTEM ====================
            {
                name: "read-file",
                description: "Read file content from the executor workspace filesystem.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Relative file path in executor workspace." }
                    },
                    required: ["path"]
                }
            },
            {
                name: "write-file",
                description: "Write text content to a file in the executor workspace filesystem.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Relative file path." },
                        content: { type: "string", description: "Text content to write." }
                    },
                    required: ["path", "content"]
                }
            },
            {
                name: "delete-file",
                description: "Delete a file or folder in the executor workspace filesystem.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Relative file or folder path." }
                    },
                    required: ["path"]
                }
            },
            {
                name: "list-files",
                description: "List files and folders in an executor workspace directory.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Directory path (empty for root)." }
                    }
                }
            },
            {
                name: "create-folder",
                description: "Create a directory in the executor workspace filesystem.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Directory path to create." }
                    },
                    required: ["path"]
                }
            },
            {
                name: "load-custom-asset",
                description: "Load a local image, sound, or mesh file into an rbxasset:// custom asset URL.",
                inputSchema: {
                    type: "object",
                    properties: {
                        file_path: { type: "string", description: "Path to file in executor workspace." }
                    },
                    required: ["file_path"]
                }
            },

            // ==================== 10. SERVER & OPS ====================
            {
                name: "list-roblox-processes",
                description: "List running Roblox processes with connection status table (connected vs unconnected).",
                inputSchema: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "launch-roblox",
                description: "Launch the Roblox Player desktop application.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Optional custom path to RobloxPlayerLauncher.exe." }
                    }
                }
            },
            {
                name: "open-roblox-game",
                description: "Launch or join a Roblox game experience via PlaceId and optional private server code.",
                inputSchema: {
                    type: "object",
                    properties: {
                        place_id: { type: "number", description: "Target game PlaceId." },
                        job_id: { type: "string", description: "Optional server JobId to join specific server." },
                        private_server_link_code: { type: "string", description: "Optional private server link code." }
                    },
                    required: ["place_id"]
                }
            },
            {
                name: "take-screenshot",
                description: "Capture a screenshot of a Roblox window by PID or workerId.",
                inputSchema: {
                    type: "object",
                    properties: {
                        pid: { type: "number", description: "Process ID of the Roblox window to capture." },
                        output_path: { type: "string", description: "Destination file path for the PNG. Defaults to the OS temp folder." }
                    }
                }
            },
            {
                name: "record-roblox-video",
                description: "Record a 30 FPS MP4 video of a Roblox window for a duration of seconds.",
                inputSchema: {
                    type: "object",
                    properties: {
                        pid: { type: "number", description: "PID of Roblox process to record." },
                        duration_seconds: { type: "number", description: "Recording duration in seconds (max 30)." },
                        output_path: { type: "string", description: "Destination file path for the MP4. Defaults to the OS temp folder." }
                    }
                }
            },
            {
                name: "get-transport-status",
                description: "Inspect active transport mode (Auto / WS / Stream), worker counts, and endpoints.",
                inputSchema: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "set-transport-mode",
                description: "Switch communication transport mode between 'auto', 'ws', and 'stream'.",
                inputSchema: {
                    type: "object",
                    properties: {
                        mode: { type: "string", enum: ["auto", "ws", "stream"], description: "Transport mode to activate." }
                    },
                    required: ["mode"]
                }
            },
            {
                name: "set-autoexecute",
                description: "Configure automatic re-execution of MCP client script across server teleports.",
                inputSchema: {
                    type: "object",
                    properties: {
                        enabled: { type: "boolean", description: "True to arm autoexecute across all teleports, false to disable." }
                    },
                    required: ["enabled"]
                }
            },
            {
                name: "get-metadata",
                description: "Retrieve game session metadata: PlaceId, GameId, JobId, Place Name, and Server Time.",
                inputSchema: {
                    type: "object",
                    properties: {
                        include_performance: { type: "boolean", description: "Include FPS and memory stats." }
                    }
                }
            },
            {
                name: "get-console-logs",
                description: "Read developer console logs (prints, warnings, and errors) from LogService.",
                inputSchema: {
                    type: "object",
                    properties: {
                        log_type: { type: "string", enum: ["all", "message", "warning", "error", "info"], description: "Filter by log type." },
                        max_lines: { type: "number", description: "Maximum recent lines to retrieve." }
                    }
                }
            }
        ];
    }
}

module.exports = { ToolDefinitions };
