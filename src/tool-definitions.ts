

interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

class ToolDefinitions {
    private tools: ToolDefinition[];

    constructor() {
        this.tools = this._defineTools().map(tool => {
            tool.inputSchema = this._sanitizeSchema(tool.inputSchema);
            return tool;
        });
    }

    private _sanitizeSchema(schema: any): any {
        const sanitize = (obj: any): any => {
            if (!obj || typeof obj !== 'object') return obj;

            if (Array.isArray(obj)) {
                return obj.map(item => sanitize(item));
            }

            // Ensure JSON schema types are lowercase (string, object, array, boolean, number)
            if (typeof obj.type === 'string') {
                obj.type = obj.type.toLowerCase();
            }

            // Gemini/Vertex AI strict rules: delete unsupported keys
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

        // Ensure root has a type and properties
        if (!schema.type) schema.type = 'object';
        if (!schema.properties) schema.properties = {};

        return sanitize(schema);
    }

    private _defineTools(): ToolDefinition[] {
        return [

            {
                name: "disable_client_anticheat",
                description: "Disables local client-side integrity mechanisms. Hooks Kick/Destroy to prevent the client from kicking itself, optionally disables local scripts matching known integrity validation patterns, blocks teleport-based kicks, and enables an anti-AFK loop.",
                inputSchema: {
                    type: "object",
                    properties: {
                        hook_kick: { type: "boolean", description: "Hook LocalPlayer.Kick and humanoid death to prevent kicks. Default true." },
                        disable_ac_scripts: { type: "boolean", description: "Scan and disable LocalScripts matching AC patterns (e.g. 'anticheat', 'guardian'). Default false." },
                        block_teleport: { type: "boolean", description: "Hook TeleportService to prevent teleport-based kicks/bans. Default true." },
                        anti_afk: { type: "boolean", description: "Enable background Anti-AFK loop to prevent 20-min idle kick. Default false." },
                        afk_interval: { type: "number", description: "Interval in seconds for Anti-AFK actions. Default 30." }
                    },
                    required: []
                }
            },



            {
                name: "recursive_tree_walker",
                description: "Walks the Roblox instance tree recursively starting from a given root, returning instances that match the specified filters. Supports configurable maximum depth to prevent runaway traversal, class-name filtering (e.g. only 'Part' or 'Model'), and name-based filtering with wildcard or regex patterns. Results include the full hierarchy path for each matched instance and the total count of nodes visited.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "start_path": {
                            "type": "string",
                            "description": "Root instance path to start traversal from, e.g. 'game.Workspace' or 'game.ReplicatedStorage'. Defaults to 'game'.",
                            "default": "game"
                        },
                        "max_depth": {
                            "type": "integer",
                            "description": "Maximum recursion depth. 0 means only the start node, 1 includes direct children, etc. Use -1 for unlimited.",
                            "default": 10,
                            "minimum": -1,
                            "maximum": 100
                        },
                        "class_filter": {
                            "type": "string",
                            "description": "Only return instances whose ClassName matches this value. Supports comma-separated OR matching, e.g. 'Part,Model,WedgePart'. Empty string means no filter.",
                            "default": ""
                        },
                        "name_pattern": {
                            "type": "string",
                            "description": "Glob or regex pattern to match instance names against (e.g. 'Door*', '^Enemy_'). Uses case-insensitive matching. Empty string means no filter.",
                            "default": ""
                        },
                        "name_match_mode": {
                            "type": "string",
                            "description": "Whether the name pattern uses glob-style wildcards (glob) or regular expression (regex) matching.",
                            "default": "glob",
                            "enum": [
                                "glob",
                                "regex"
                            ]
                        },
                        "include_services": {
                            "type": "boolean",
                            "description": "Whether to include Roblox service instances (like Workspace, Players, etc.) in results. Services are typically under the DataModel.",
                            "default": true
                        },
                        "include_players": {
                            "type": "boolean",
                            "description": "Whether to descend into and include children of the Players service (each player's Player instance).",
                            "default": true
                        },
                        "max_results": {
                            "type": "integer",
                            "description": "Maximum number of matching instances to return. 0 means unlimited.",
                            "default": 200,
                            "minimum": 0,
                            "maximum": 10000
                        },
                        "return_hierarchy": {
                            "type": "boolean",
                            "description": "When true, each result includes the full dot-delimited ancestor path for context.",
                            "default": true
                        }
                    },
                    "required": []
                },
            },
            {
                name: "service_discoverer",
                description: "Enumerates all Roblox engine services currently instantiated under the DataModel. Services are singleton instances that provide engine-level functionality (Workspace, Players, ReplicatedStorage, etc.). Returns each service's name, ClassName, and current status (loaded/not loaded). Optionally discovers children within each service to reveal the default structure of the game environment.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "filter": {
                            "type": "string",
                            "description": "Optional case-insensitive substring filter on service name. For example 'Replicated' returns ReplicatedStorage and ReplicatedFirst. Empty string returns all services.",
                            "default": ""
                        },
                        "include_children": {
                            "type": "boolean",
                            "description": "When true, also returns the direct children of each discovered service.",
                            "default": false
                        },
                        "include_internal": {
                            "type": "boolean",
                            "description": "When true, includes internal/hidden services that are normally not visible through the game API (e.g. 'InsertService', 'ScriptInformationProvider').",
                            "default": false
                        },
                        "child_max_depth": {
                            "type": "integer",
                            "description": "Maximum depth for child traversal within each service. Only used when include_children is true.",
                            "default": 1,
                            "minimum": 0,
                            "maximum": 10
                        }
                    },
                    "required": []
                },
            },
            {
                name: "class_instance_collector",
                description: "Collects every instance of a specified Roblox class (and optionally its subclasses) throughout the entire game or within a scoped root. This is the primary tool for finding all Parts, all Scripts, all LocalScripts, all Models, etc. in one operation. Returns the full path, ClassName, and a configurable set of property values for each matched instance.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "class_name": {
                            "type": "string",
                            "description": "The exact Roblox class name to search for, e.g. 'Part', 'Script', 'LocalScript', 'Model', 'MeshPart', 'Folder', 'BoolValue', 'StringValue'.",
                            "default": ""
                        },
                        "scope": {
                            "type": "string",
                            "description": "Root instance path to constrain the search. Empty string searches from 'game' (everything).",
                            "default": ""
                        },
                        "include_subclasses": {
                            "type": "boolean",
                            "description": "When true, also includes instances of classes that inherit from the specified class_name. For example, searching 'Part' includes 'MeshPart', 'WedgePart', etc.",
                            "default": false
                        },
                        "max_results": {
                            "type": "integer",
                            "description": "Maximum number of instances to return. Use 0 for no limit (use with caution on large games).",
                            "default": 500,
                            "minimum": 0,
                            "maximum": 50000
                        },
                        "properties_to_return": {
                            "type": "array",
                            "description": "List of property names to include in results for each matched instance (e.g. ['Name', 'Parent', 'ClassName', 'Archivable']). Empty returns just the path and ClassName.",
                            "items": {
                                "type": "string"
                            },
                            "default": [
                                "Name",
                                "ClassName",
                                "Parent"
                            ]
                        },
                        "order_by": {
                            "type": "string",
                            "description": "Sort results by this property name. Empty means no particular order (breadth-first traversal order).",
                            "default": ""
                        }
                    },
                    "required": [
                        "class_name"
                    ]
                },
            },
            {
                name: "path_resolver",
                description: "Resolves a dot-delimited or slash-delimited instance path string (like 'game.Workspace.Baseplate' or 'Players/Player1/Backpack') into a concrete instance reference. Handles both absolute paths starting from 'game', 'workspace', 'players', etc., and relative paths from a given base. Returns the resolved instance path, ClassName, and any ambiguity if multiple instances match the same name at any level.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "The instance path string to resolve. Accepts dot notation ('game.Workspace.Part'), slash notation ('Workspace/Part'), or mixed. Common prefixes like 'game.', 'workspace.', or 'players.' are handled automatically.",
                            "default": ""
                        },
                        "base_path": {
                            "type": "string",
                            "description": "Optional base instance path for resolving relative paths. If the provided path does not start with a known root, it is resolved relative to this base. Defaults to 'game'.",
                            "default": "game"
                        },
                        "allow_partial": {
                            "type": "boolean",
                            "description": "When true, returns intermediate results even if the full path cannot be fully resolved (e.g. 'game.Workspace.MissingPart.SomeChild' resolves up to Workspace).",
                            "default": false
                        },
                        "strict_mode": {
                            "type": "boolean",
                            "description": "When true, returns an error if multiple instances share the same name at any path segment, instead of picking the first match.",
                            "default": false
                        }
                    },
                    "required": [
                        "path"
                    ]
                },
            },
            {
                name: "sibling_enumerator",
                description: "Enumerates sibling instances around a given instance path within the same parent container. Useful for understanding the layout of objects at the same hierarchy level, such as all tools in a Toolbox folder, all enemies in an EnemySpawner, or all parts in a Model. Can return siblings before, after, or including the target instance, and optionally include index/order information.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "instance_path": {
                            "type": "string",
                            "description": "Path to the reference instance whose siblings should be enumerated, e.g. 'game.Workspace.MyModel.MyPart'.",
                            "default": ""
                        },
                        "direction": {
                            "type": "string",
                            "description": "Which siblings relative to the reference instance to return. 'all' returns every sibling. 'before' returns only siblings at lower indices. 'after' returns only siblings at higher indices.",
                            "default": "all",
                            "enum": [
                                "all",
                                "before",
                                "after"
                            ]
                        },
                        "include_self": {
                            "type": "boolean",
                            "description": "Whether to include the reference instance itself in the returned list.",
                            "default": false
                        },
                        "class_filter": {
                            "type": "string",
                            "description": "Only include siblings whose ClassName matches this value. Supports comma-separated values for OR matching.",
                            "default": ""
                        },
                        "max_results": {
                            "type": "integer",
                            "description": "Maximum siblings to return. 0 means no limit.",
                            "default": 100,
                            "minimum": 0,
                            "maximum": 5000
                        }
                    },
                    "required": [
                        "instance_path"
                    ]
                },
            },
            {
                name: "attribute_seeker",
                description: "Searches the instance tree for instances that have specific attributes set (via Instance:SetAttribute). Attributes are custom key-value pairs that developers attach to instances for game logic. Supports matching by attribute name (exact or pattern), attribute value (with type-aware comparison), or the mere presence of an attribute regardless of value. Narrows search scope with a root path and class filter for performance.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "attribute_name": {
                            "type": "string",
                            "description": "Exact attribute name to search for, or a glob/regex pattern when match_mode is 'pattern'. Case-sensitive.",
                            "default": ""
                        },
                        "attribute_value": {
                            "description": "Optional value to match against. When provided, only instances whose attribute has this value are returned. Type-aware: supports string, number, boolean, or nil (represented as null). Omit to match by attribute name alone.",
                            "oneOf": [
                                {
                                    "type": "string"
                                },
                                {
                                    "type": "number"
                                },
                                {
                                    "type": "boolean"
                                },
                                {
                                    "type": "null"
                                }
                            ]
                        },
                        "match_mode": {
                            "type": "string",
                            "description": "How attribute_name is interpreted. 'exact' requires exact match. 'pattern' enables wildcard/regex matching. 'present' returns instances that have any attribute (attribute_name is ignored unless specified).",
                            "default": "exact",
                            "enum": [
                                "exact",
                                "pattern",
                                "present"
                            ]
                        },
                        "scope": {
                            "type": "string",
                            "description": "Root path to constrain the search. Empty searches the entire game tree.",
                            "default": ""
                        },
                        "class_filter": {
                            "type": "string",
                            "description": "Only search within instances of this class. Comma-separated for multi-class.",
                            "default": ""
                        },
                        "max_results": {
                            "type": "integer",
                            "description": "Maximum instances to return.",
                            "default": 100,
                            "minimum": 1,
                            "maximum": 10000
                        }
                    },
                    "required": []
                },
            },
            {
                name: "tag_collector",
                description: "Finds all instances that have been tagged with one or more CollectionService tags. CollectionService provides a lightweight tagging system for grouping arbitrary instances without modifying the hierarchy. Supports 'any' mode (instances matching at least one tag) and 'all' mode (instances matching every specified tag). Critical for understanding game systems that use tag-based discovery rather than hierarchy.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "tags": {
                            "type": "array",
                            "description": "List of CollectionService tag strings to search for. At least one tag is required.",
                            "items": {
                                "type": "string"
                            },
                            "minItems": 1
                        },
                        "match_mode": {
                            "type": "string",
                            "description": "When 'any', returns instances that have ANY of the specified tags. When 'all', returns instances that have ALL specified tags.",
                            "default": "any",
                            "enum": [
                                "any",
                                "all"
                            ]
                        },
                        "scope": {
                            "type": "string",
                            "description": "Root instance path to constrain the search. Empty searches from the entire DataModel.",
                            "default": ""
                        },
                        "class_filter": {
                            "type": "string",
                            "description": "Only return instances whose ClassName matches. Comma-separated values for multiple classes.",
                            "default": ""
                        },
                        "max_results": {
                            "type": "integer",
                            "description": "Maximum number of tagged instances to return.",
                            "default": 200,
                            "minimum": 1,
                            "maximum": 10000
                        },
                        "include_tag_list": {
                            "type": "boolean",
                            "description": "When true, each result includes the full list of tags attached to that instance.",
                            "default": false
                        }
                    },
                    "required": [
                        "tags"
                    ]
                },
            },
            {
                name: "child_watcher",
                description: "Sets up monitoring on a specific instance to observe child additions, removals, and reorderings. Returns a snapshot of current children followed by a log of changes that occur within the observation window. This is the tool for understanding dynamic game behavior, such as detecting when new enemies spawn into a folder, when tools are added to a player's Backpack, or when parts are created/destroyed during gameplay.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "target_path": {
                            "type": "string",
                            "description": "Path to the instance whose children should be monitored, e.g. 'game.Workspace.Enemies' or 'game.Players.LocalPlayer.Backpack'.",
                            "default": ""
                        },
                        "event_types": {
                            "type": "array",
                            "description": "Which child change events to capture. 'added' for new children, 'removed' for destroyed/removed children, 'reordered' for child index changes. Empty means all types.",
                            "items": {
                                "type": "string",
                                "enum": [
                                    "added",
                                    "removed",
                                    "reordered"
                                ]
                            },
                            "default": [
                                "added",
                                "removed"
                            ]
                        },
                        "duration_ms": {
                            "type": "integer",
                            "description": "How long to watch for changes, in milliseconds. Longer durations capture more game ticks but take longer to return.",
                            "default": 5000,
                            "minimum": 100,
                            "maximum": 60000
                        },
                        "class_filter": {
                            "type": "string",
                            "description": "Only report changes involving children whose ClassName matches this filter. Comma-separated for multiple classes.",
                            "default": ""
                        },
                        "snapshot_first": {
                            "type": "boolean",
                            "description": "When true, returns the full list of current children before beginning to watch for changes.",
                            "default": true
                        }
                    },
                    "required": [
                        "target_path"
                    ]
                },
            },
            {
                name: "nil_realm_scanner",
                description: "Scans for instances that are parented to nil (i.e. not present in the active DataModel tree) but still referenced by scripts or other objects. This is critical for finding hidden, orphaned, or cached objects that game developers have temporarily removed from the tree or that leaked due to reference retention. Can also scan for objects directly parented to the DataModel's top level that may be intentionally hidden from normal traversal.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "scan_type": {
                            "type": "string",
                            "description": "'orphaned' scans for instances whose Parent is nil (removed from tree but still alive). 'datamodel_root' scans for instances directly parented to the DataModel that are normally hidden. 'both' performs both scans.",
                            "default": "orphaned",
                            "enum": [
                                "orphaned",
                                "datamodel_root",
                                "both"
                            ]
                        },
                        "class_filter": {
                            "type": "string",
                            "description": "Only return instances matching this ClassName. Comma-separated for multiple classes.",
                            "default": ""
                        },
                        "max_results": {
                            "type": "integer",
                            "description": "Maximum instances to return.",
                            "default": 100,
                            "minimum": 1,
                            "maximum": 5000
                        },
                        "include_path_only": {
                            "type": "boolean",
                            "description": "When true, returns only the path/name info without scanning property values for orphaned instances.",
                            "default": false
                        }
                    },
                    "required": []
                },
            },
            {
                name: "property_value_seeker",
                description: "Searches the instance tree for instances where a specific property has a given value. Supports exact match, numeric range match, and pattern match for string properties. For example, finding all Parts where 'Transparency' equals 0.5, all BaseParts where 'Material' equals 'Neon', or all instances where 'Visible' is false. Uses the scoped root and class filter to keep searches efficient on large games.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "property_name": {
                            "type": "string",
                            "description": "The name of the property to check, e.g. 'Transparency', 'Material', 'Visible', 'Size', 'Color', 'Value', 'Position', 'Text', 'BackgroundColor3'.",
                            "default": ""
                        },
                        "property_value": {
                            "description": "The target property value to match. Type depends on the property: numbers for numeric properties, strings for string/enum properties, booleans for boolean properties. For Color3 or Vector3 properties, use the string format like '0.5,0.5,0.5' or '10,20,30'.",
                            "type": "string"
                        },
                        "match_mode": {
                            "type": "string",
                            "description": "How the property_value is matched against the actual property. 'exact' strict equality, 'contains' substring match (string props), 'gte' greater-than-or-equal (numeric), 'lte' less-than-or-equal (numeric), 'range' uses range_min/range_max for numeric bounds.",
                            "default": "exact",
                            "enum": [
                                "exact",
                                "contains",
                                "gte",
                                "lte",
                                "range"
                            ]
                        },
                        "range_min": {
                            "type": "number",
                            "description": "Lower bound for range match_mode. Only used when match_mode is 'range'.",
                            "default": null
                        },
                        "range_max": {
                            "type": "number",
                            "description": "Upper bound for range match_mode. Only used when match_mode is 'range'.",
                            "default": null
                        },
                        "case_sensitive": {
                            "type": "boolean",
                            "description": "When matching string properties, whether comparison is case-sensitive.",
                            "default": false
                        },
                        "scope": {
                            "type": "string",
                            "description": "Root instance path to constrain the search. Empty searches the entire game tree.",
                            "default": ""
                        },
                        "class_filter": {
                            "type": "string",
                            "description": "Only search within instances whose ClassName matches. Comma-separated for multiple classes.",
                            "default": ""
                        },
                        "max_results": {
                            "type": "integer",
                            "description": "Maximum instances to return.",
                            "default": 100,
                            "minimum": 1,
                            "maximum": 10000
                        }
                    },
                    "required": [
                        "property_name",
                        "property_value"
                    ]
                },
            },
            {
                name: "spatial_proximity_scanner",
                description: "Finds instances within a specified 3D radius around a given world position. Only works on spatial instances (BasePart subclasses and Attachments that have a world-space position). Critical for security testing tasks like finding all parts near a player's character, detecting nearby pickups/collectibles, locating spawned enemies around a coordinate, or identifying teleport-pad triggers. Results can be sorted by distance and filtered by class.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "position": {
                            "type": "object",
                            "description": "The 3D world position (CFrame.Position) to use as the search origin.",
                            "properties": {
                                "x": {
                                    "type": "number",
                                    "description": "X coordinate in world space."
                                },
                                "y": {
                                    "type": "number",
                                    "description": "Y coordinate in world space."
                                },
                                "z": {
                                    "type": "number",
                                    "description": "Z coordinate in world space."
                                }
                            },
                            "required": [
                                "x",
                                "y",
                                "z"
                            ]
                        },
                        "radius": {
                            "type": "number",
                            "description": "Search radius in studs around the target position.",
                            "default": 50,
                            "minimum": 1,
                            "maximum": 50000
                        },
                        "scope": {
                            "type": "string",
                            "description": "Root instance path to constrain the spatial search. Typically 'game.Workspace' since non-workspace instances usually don't have world positions. Empty searches the entire game.",
                            "default": ""
                        },
                        "class_filter": {
                            "type": "string",
                            "description": "Only return instances matching this ClassName. Useful for finding specific spatial types like 'Part', 'MeshPart', 'Model', 'Attachment'. Comma-separated for multiple values.",
                            "default": "BasePart"
                        },
                        "max_results": {
                            "type": "integer",
                            "description": "Maximum instances to return.",
                            "default": 100,
                            "minimum": 1,
                            "maximum": 5000
                        },
                        "sort_by_distance": {
                            "type": "boolean",
                            "description": "When true, results are sorted from nearest to farthest from the target position.",
                            "default": true
                        },
                        "include_distance": {
                            "type": "boolean",
                            "description": "When true, each result includes the computed distance in studs from the target position.",
                            "default": false
                        }
                    },
                    "required": [
                        "position"
                    ]
                },
            },
            {
                name: "class_subtree_enumerator",
                description: "Enumerates all instances of a given Roblox Lua class AND all of its subclass types by walking the class inheritance tree. Unlike class_instance_collector which matches only the exact class, this tool includes every derived class. For example, enumerating 'Instance' returns every single object in the game, 'BasePart' returns Parts, MeshParts, WedgeParts, CornerWedgeParts, etc., and 'PVInstance' returns all Models and BaseParts. Accepts a scope root to limit search range.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "class_name": {
                            "type": "string",
                            "description": "The base Roblox class name to start from. Instances of this class and all its subclasses will be included. Use 'Instance' to collect everything.",
                            "default": ""
                        },
                        "scope": {
                            "type": "string",
                            "description": "Root instance path to constrain the search. Empty searches from 'game'.",
                            "default": ""
                        },
                        "max_depth": {
                            "type": "integer",
                            "description": "Maximum recursion depth from the scope root into the instance tree. -1 for unlimited.",
                            "default": -1,
                            "minimum": -1,
                            "maximum": 100
                        },
                        "max_results": {
                            "type": "integer",
                            "description": "Maximum instances to return.",
                            "default": 500,
                            "minimum": 1,
                            "maximum": 50000
                        },
                        "properties_to_return": {
                            "type": "array",
                            "description": "Property names to include for each result (e.g. 'Name', 'ClassName', 'Parent', 'Archivable', 'Size').",
                            "items": {
                                "type": "string"
                            },
                            "default": [
                                "Name",
                                "ClassName"
                            ]
                        },
                        "include_class_hierarchy": {
                            "type": "boolean",
                            "description": "When true, each result includes a 'class_chain' field showing the full inheritance path (e.g. 'Instance > PVInstance > BasePart > Part').",
                            "default": false
                        }
                    },
                    "required": [
                        "class_name"
                    ]
                },
            },
            
            {
                name: "get_instance_from_path",
                description: "Resolve any arbitrary game path string and return its properties. Useful when you know the path to an object and want to inspect it without scanning the whole tree.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Full game path to the instance (e.g. game.Workspace.Part or workspace.Part)"
                        },
                        "include_children": {
                            "type": "boolean",
                            "description": "Include immediate children in the result",
                            "default": false
                        },
                        "max_child_depth": {
                            "type": "number",
                            "description": "Maximum depth for child enumeration",
                            "default": 1
                        }
                    },
                    "required": [
                        "path"
                    ]
                },
            },





            {
                name: "property_bulk_reader",
                description: "Reads one or more named properties from any Roblox Instance in a single operation. Accepts an array of property names and returns a map of property names to their current values. Supports nested property paths using dot notation (e.g., 'Humanoid.WalkSpeed'). Optimized for batch reads to minimize round-trips and bypass Lua-level getter overhead when possible.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "instance_path": {
                            "type": "string",
                            "description": "Full path to the target Instance (e.g., 'workspace.Player', 'Players.difzz.LocalPlayer'). Supports colon-delimited service references (':Players').",
                            "minLength": 1
                        },
                        "property_list": {
                            "type": "array",
                            "items": {
                                "type": "string",
                                "description": "Property name, optionally using dot notation for nested access (e.g., 'Humanoid.WalkSpeed')",
                                "minLength": 1
                            },
                            "minItems": 1,
                            "maxItems": 50,
                            "description": "List of property names or dot-delimited property paths to read. Maximum 50 per call."
                        },
                        "use_get_property": {
                            "type": "boolean",
                            "description": "If true, uses Instance:GetProperty() instead of direct property access for cases where the property may be filtered by Roblox security. Default false.",
                            "default": false
                        }
                    },
                    "required": [
                        "instance_path",
                        "properties"
                    ]
                },
            },
            {
                name: "property_deep_dive",
                description: "Performs a deep inspection of a single property on a Roblox Instance, returning its current value alongside full metadata: Roblox data type, security context (Readable/Writable/NotReplicated status), replication flag, serialization group, and the property's default value. Additionally returns the resolved Lua type (CFrame, Vector3, BrickColor, EnumItem, etc.) when applicable. Useful for understanding property constraints before attempting to modify them.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "instance_path": {
                            "type": "string",
                            "description": "Full path to the target Instance (e.g., 'workspace.Part', 'Players.difzz.LocalPlayer')",
                            "minLength": 1
                        },
                        "property_name": {
                            "type": "string",
                            "description": "Exact name of the property to inspect. Case-sensitive and must match the Roblox property name as returned by Instance:GetPropertyChangedSignal() registration.",
                            "minLength": 1
                        },
                        "include_default": {
                            "type": "boolean",
                            "description": "If true, also retrieves the ClassInfo default value for this property to compare against the current value. Default true.",
                            "default": true
                        },
                        "include_security": {
                            "type": "boolean",
                            "description": "If true, includes the Roblox security annotation (None, LocalUser, Plugin, RobloxScript) for both read and write access. Default true.",
                            "default": true
                        }
                    },
                    "required": [
                        "instance_path",
                        "property_name"
                    ]
                },
            },
            
            
            
            {
                name: "humanoid_state_extractor",
                description: "Extracts the complete detailed state of a Humanoid instance. Returns all key properties including Health, MaxHealth, WalkSpeed, JumpPower, JumpHeight, AutoJumpEnabled, AutoRotate, FloorMaterial, MoveDirection, RigType, HipHeight, NameOcclusion, DisplayDistanceType, HealthDisplayDistance, CameraOffset, SeatedPart, PlatformStand, UseJumpPower, BreakJointsOnDeath, MaxSlopeAngle, and StateType (as a human-readable string). Designed for ESP, player state overlays, and movement system analysis in compromised clients.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "humanoid_path": {
                            "type": "string",
                            "description": "Full path to the Humanoid instance. Typically accessible via 'Instance:FindFirstChildOfClass(\"Humanoid\")' on a Character. Path examples: 'workspace.CharacterName.Humanoid', or a direct Instance reference.",
                            "minLength": 1
                        },
                        "include_character_metadata": {
                            "type": "boolean",
                            "description": "If true, also returns the parent Character's name, ClassName, and whether it has a HumanoidRootPart. Default true.",
                            "default": true
                        },
                        "resolve_enum_names": {
                            "type": "boolean",
                            "description": "If true, resolves all Enum values (RigType, StateType, etc.) to their string names instead of returning raw integers. Default true.",
                            "default": true
                        }
                    },
                    "required": [
                        "humanoid_path"
                    ]
                },
            },
            
            
            {
                name: "class_blueprint_viewer",
                description: "Returns the complete reflection metadata for any Roblox Lua class as defined by the engine's internal ClassInfo registration. Output includes all Properties with their type, category, security, and replication flags; all Events with their parameter signatures; all Functions/Callbacks with their parameter types; and the class's superclass hierarchy. Supports both Instance classes (Part, Script, etc.) and enums/typedefs. Essential for understanding the full validation surface of a class when developing security tests.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "class_name": {
                            "type": "string",
                            "description": "The exact, case-sensitive Roblox class name to inspect (e.g., 'Part', 'Humanoid', 'LocalScript', 'ScreenGui', 'Player', 'DataModel'). Use a tool like 'EnumerateClasses' if unsure of the exact name.",
                            "minLength": 1
                        },
                        "include_inherited_members": {
                            "type": "boolean",
                            "description": "If true, includes properties, events, and functions inherited from all ancestor classes (e.g., Part inherits from PVInstance, Instance, etc.). Default true.",
                            "default": true
                        },
                        "include_property_metadata": {
                            "type": "boolean",
                            "description": "If true, returns full metadata per property: value type, category, security (read/write), replication behavior, and default value. Default true.",
                            "default": true
                        },
                        "include_event_signatures": {
                            "type": "boolean",
                            "description": "If true, returns event parameter type signatures for all Events. Default true.",
                            "default": true
                        }
                    },
                    "required": [
                        "class_name"
                    ]
                },
            },
            
            
            {
                name: "get_game_metadata",
                description: "Retrieve PlaceId, UniverseId, GameId, JobId, Player count, Max players, Place name, Creator info, server time (tick), FPS, and memory stats of the current Roblox session. Returns everything in a single structured payload.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "include_performance": {
                            "type": "boolean",
                            "description": "Include FPS and memory stats",
                            "default": true
                        }
                    },
                    "required": []
                },
            },
            {
                name: "get_local_player_data",
                description: "Dump the LocalPlayer in depth: Backpack contents, Leaderstats, Character state, Humanoid details, active ScreenGuis, and player scripts. Gives a complete picture of the client-side player state.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "include_backpack": {
                            "type": "boolean",
                            "description": "Include backpack tool/weapon contents",
                            "default": true
                        },
                        "include_leaderstats": {
                            "type": "boolean",
                            "description": "Include leaderstats folder values",
                            "default": true
                        },
                        "include_character": {
                            "type": "boolean",
                            "description": "Include character and humanoid details",
                            "default": true
                        },
                        "include_player_scripts": {
                            "type": "boolean",
                            "description": "Include player script instances",
                            "default": false
                        },
                        "include_gui": {
                            "type": "boolean",
                            "description": "Include active ScreenGui instances",
                            "default": true
                        }
                    },
                    "required": []
                },
            },





            {
                name: "viewport_capture_handler",
                description: "Captures the current game viewport as a screenshot using render-stepped injection for frame-accurate timing. Supports configurable image format, compression quality, and optional region cropping. Returns the screenshot as a base64-encoded PNG or JPEG image buffer for downstream processing or display.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "format": {
                            "type": "string",
                            "description": "Output image format",
                            "enum": [
                                "png",
                                "jpeg"
                            ],
                            "default": "png"
                        },
                        "quality": {
                            "type": "integer",
                            "description": "JPEG compression quality (1-100). Only applies when format is jpeg.",
                            "default": 90,
                            "minimum": 1,
                            "maximum": 100
                        },
                        "region_x": {
                            "type": "integer",
                            "description": "Optional crop region top-left X coordinate in pixels",
                            "minimum": 0
                        },
                        "region_y": {
                            "type": "integer",
                            "description": "Optional crop region top-left Y coordinate in pixels",
                            "minimum": 0
                        },
                        "region_width": {
                            "type": "integer",
                            "description": "Optional crop region width in pixels",
                            "minimum": 1
                        },
                        "region_height": {
                            "type": "integer",
                            "description": "Optional crop region height in pixels",
                            "minimum": 1
                        },
                        "render_stepped_delay": {
                            "type": "number",
                            "description": "Number of render steps to wait before capturing to ensure frame stability",
                            "default": 1,
                            "minimum": 0,
                            "maximum": 10
                        },
                        "include_gui": {
                            "type": "boolean",
                            "description": "Whether to include GUI elements in the capture",
                            "default": true
                        }
                    },
                    "additionalProperties": false,
                    "required": []
                },
            },
            {
                name: "gui_hierarchy_dumper",
                description: "Recursively dumps the full CoreGui layer tree including all descendant instances (ScreenGui, Frame, TextLabel, ImageLabel, TextButton, ScrollingFrame, etc.). Returns each node with its class name, instance name, absolute position, absolute size, visibility state, and a list of applied properties. Supports depth limiting, class filtering, and property whitelisting to reduce output verbosity.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "max_depth": {
                            "type": "integer",
                            "description": "Maximum recursion depth when traversing the GUI tree",
                            "default": 20,
                            "minimum": 1,
                            "maximum": 100
                        },
                        "class_filters": {
                            "type": "array",
                            "description": "Only include elements whose ClassName matches one of these values (e.g. TextLabel, Frame, ImageButton)",
                            "items": {
                                "type": "string"
                            },
                        },
                        "include_hidden": {
                            "type": "boolean",
                            "description": "Whether to include GUI elements whose Visible property is false",
                            "default": true
                        },
                        "include_properties": {
                            "type": "boolean",
                            "description": "Whether to include per-instance property values in the output",
                            "default": true
                        },
                        "property_whitelist": {
                            "type": "array",
                            "description": "If specified, only these property names will be returned for each element",
                            "items": {
                                "type": "string"
                            },
                        },
                        "root_container": {
                            "type": "string",
                            "description": "Name of the root GUI container to dump (e.g. CoreGui, PlayerGui, StarterGui). Defaults to CoreGui.",
                            "default": "CoreGui",
                            "enum": [
                                "CoreGui",
                                "PlayerGui",
                                "StarterGui"
                            ]
                        },
                        "include_absolute_position": {
                            "type": "boolean",
                            "description": "Whether to compute and include the absolute screen position for each element",
                            "default": true
                        }
                    },
                    "additionalProperties": false,
                    "required": []
                },
            },
            {
                name: "screen_text_extractor",
                description: "Scans all visible GUI elements (TextLabel, TextButton, TextBox, TextButton, etc.) and extracts their rendered text content along with bounding box and styling information. Supports filtering by parent container, text content regex pattern matching, and deduplication. Returns the extracted text segments with screen coordinates for contextual understanding.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "pattern_filter": {
                            "type": "string",
                            "description": "Optional regex pattern to filter extracted text. Only elements whose text matches this pattern will be returned."
                        },
                        "container_path": {
                            "type": "string",
                            "description": "Optional dot-separated path to a specific GUI container to scope the search (e.g. CoreGui.RobloxGui)"
                        },
                        "include_styling": {
                            "type": "boolean",
                            "description": "Whether to include font name, font size, text color, and text stroke information",
                            "default": false
                        },
                        "include_positions": {
                            "type": "boolean",
                            "description": "Whether to include the AbsolutePosition and AbsoluteSize of each text-bearing element",
                            "default": true
                        },
                        "deduplicate": {
                            "type": "boolean",
                            "description": "Whether to collapse duplicate text strings appearing in multiple elements",
                            "default": true
                        },
                        "only_visible": {
                            "type": "boolean",
                            "description": "Only extract text from elements that are currently visible on screen",
                            "default": true
                        },
                        "max_results": {
                            "type": "integer",
                            "description": "Maximum number of text elements to return",
                            "default": 200,
                            "minimum": 1,
                            "maximum": 5000
                        }
                    },
                    "additionalProperties": false,
                    "required": []
                },
            },
            {
                name: "gui_injector",
                description: "Injects a custom ScreenGui, BillboardGui, or SurfaceGui into the game client with fully configurable properties. Supports setting size, position, background color, border, transparency, z-index behavior, and event bindings. Can optionally auto-destroy after a specified duration or on player death. Returns the instance identifier for subsequent manipulation or removal.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "gui_type": {
                            "type": "string",
                            "description": "Type of GUI container to inject",
                            "enum": [
                                "ScreenGui",
                                "BillboardGui",
                                "SurfaceGui"
                            ],
                            "default": "ScreenGui"
                        },
                        "name": {
                            "type": "string",
                            "description": "Name for the injected GUI instance (used for later reference)",
                            "minLength": 1,
                            "maxLength": 64
                        },
                        "parent": {
                            "type": "string",
                            "description": "Parent container to inject into (e.g. CoreGui, PlayerGui). Defaults to CoreGui.",
                            "default": "CoreGui"
                        },
                        "property_map": {
                            "type": "string",
                            "description": "JSON string of property name-value pairs (e.g. '{\"DisplayOrder\":2,\"Enabled\":true}'). Empty string or null means no custom properties."
                        },
                        "children": {
                            "type": "string",
                            "description": "JSON string of child GUI element definitions (e.g. '[{\"class_name\":\"TextLabel\",\"name\":\"Title\",\"properties\":{\"Text\":\"Hello\",\"Size\":\"UDim2.new(0,200,0,50)\"}}]'). Empty string or null means no children."
                        },
                        "auto_destroy_after": {
                            "type": "number",
                            "description": "Time in seconds after which the injected GUI auto-destroys. 0 means persistent until manually removed.",
                            "default": 0,
                            "minimum": 0
                        },
                        "destroy_on_death": {
                            "type": "boolean",
                            "description": "Whether to automatically destroy this GUI when the local player character dies",
                            "default": false
                        }
                    },
                    "additionalProperties": false,
                    "required": [
                        "name"
                    ]
                },
            },
            {
                name: "esp_label_manager",
                description: "Manages ESP (Extra Sensory Perception) overlay labels that attach to players, NPCs, or world objects. Supports creating, updating, and destroying billboard-style text overlays with configurable text, color, font size, transparency, and attachment offset. Labels track their target object position automatically each frame via RenderStepped. Returns an identifier for each created label for later modification.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "description": "Operation to perform: create (spawn a new ESP label), update (modify an existing label's properties), remove (destroy an existing label), remove_all (destroy all managed labels)",
                            "enum": [
                                "create",
                                "update",
                                "remove",
                                "remove_all"
                            ]
                        },
                        "label_id": {
                            "type": "string",
                            "description": "Unique identifier for the label. Required for update and remove actions. Auto-generated if omitted for create actions.",
                            "minLength": 1,
                            "maxLength": 64
                        },
                        "target_type": {
                            "type": "string",
                            "description": "Type of target to attach the label to",
                            "enum": [
                                "player",
                                "npc",
                                "world_object",
                                "part",
                                "model"
                            ],
                            "default": "player"
                        },
                        "target_identifier": {
                            "type": "string",
                            "description": "Player name, instance path, or object reference to attach the label to. For player type, use the player's DisplayName or Name.",
                            "minLength": 1,
                            "maxLength": 128
                        },
                        "label_text": {
                            "type": "string",
                            "description": "Text content to display on the ESP label. Supports newline characters for multi-line labels.",
                            "maxLength": 512
                        },
                        "text_color": {
                            "type": "array",
                            "description": "RGB color for the label text as [R, G, B] where each value is 0-255",
                            "items": {
                                "type": "integer",
                                "minimum": 0,
                                "maximum": 255
                            },
                            "minItems": 3,
                            "maxItems": 3
                        },
                        "background_color": {
                            "type": "array",
                            "description": "RGB background color as [R, G, B] where each value is 0-255. Null for no background.",
                            "items": {
                                "type": "integer",
                                "minimum": 0,
                                "maximum": 255
                            },
                            "minItems": 3,
                            "maxItems": 3
                        },
                        "text_size": {
                            "type": "integer",
                            "description": "Font size for the label text in scaled units",
                            "default": 14,
                            "minimum": 8,
                            "maximum": 48
                        },
                        "transparency": {
                            "type": "number",
                            "description": "Overall label transparency from 0 (opaque) to 1 (fully transparent)",
                            "default": 0,
                            "minimum": 0,
                            "maximum": 1
                        },
                        "attachment_offset": {
                            "type": "object",
                            "description": "3D world-space offset from the target's position where the label should appear",
                            "properties": {
                                "x": {
                                    "type": "number",
                                    "default": 0
                                },
                                "y": {
                                    "type": "number",
                                    "default": 3
                                },
                                "z": {
                                    "type": "number",
                                    "default": 0
                                }
                            },
                            "default": {
                                "x": 0,
                                "y": 3,
                                "z": 0
                            }
                        },
                        "show_distance": {
                            "type": "boolean",
                            "description": "Whether to append the distance from the local player to the label text",
                            "default": false
                        },
                        "max_render_distance": {
                            "type": "number",
                            "description": "Maximum stud distance from the camera at which the label remains visible. 0 means unlimited.",
                            "default": 0,
                            "minimum": 0,
                            "maximum": 10000
                        }
                    },
                    "additionalProperties": false,
                    "required": [
                        "action"
                    ]
                },
            },
            {
                name: "ui_change_watcher",
                description: "Initiates or stops real-time monitoring of GUI element changes within the game client. Detects and reports new child additions, property modifications (text, visibility, size, position, color), element removals, and z-order changes. Supports filtering by specific element paths, property names, or change types to reduce noise. Returns a stream of change events with timestamps and before-after snapshots.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "description": "Whether to start or stop monitoring",
                            "enum": [
                                "start",
                                "stop",
                                "pause",
                                "resume"
                            ]
                        },
                        "watcher_id": {
                            "type": "string",
                            "description": "Unique identifier for this watcher session. Required for stop, pause, resume. Auto-generated on start if omitted.",
                            "minLength": 1,
                            "maxLength": 64
                        },
                        "poll_interval_ms": {
                            "type": "integer",
                            "description": "Polling interval in milliseconds between change detection cycles",
                            "default": 100,
                            "minimum": 16,
                            "maximum": 5000
                        },
                        "watch_containers": {
                            "type": "array",
                            "description": "List of GUI container paths to monitor. Empty list monitors all of CoreGui.",
                            "items": {
                                "type": "string"
                            },
                        },
                        "change_types": {
                            "type": "array",
                            "description": "Types of changes to report. Empty array reports all change types.",
                            "items": {
                                "type": "string",
                                "enum": [
                                    "child_added",
                                    "child_removed",
                                    "property_changed",
                                    "visibility_changed",
                                    "position_changed",
                                    "size_changed"
                                ]
                            },
                        },
                        "property_filters": {
                            "type": "array",
                            "description": "Only report changes to these specific property names (e.g. Text, Visible, Position, Size, BackgroundColor3)",
                            "items": {
                                "type": "string"
                            },
                        },
                        "include_screenshots": {
                            "type": "boolean",
                            "description": "Whether to capture a viewport screenshot alongside each change event for visual context",
                            "default": false
                        },
                        "max_events": {
                            "type": "integer",
                            "description": "Maximum number of change events to accumulate before the watcher auto-stops. 0 means unlimited.",
                            "default": 0,
                            "minimum": 0,
                            "maximum": 10000
                        }
                    },
                    "additionalProperties": false,
                    "required": [
                        "command"
                    ]
                },
            },
            
            {
                name: "world_to_screen_converter",
                description: "Converts one or more 3D world-space coordinates (Vector3) into 2D screen-space pixel coordinates using the current camera's view-projection matrix. Handles off-screen detection: returns a boolean indicating whether the point is within the visible viewport. Supports batch conversion of multiple points in a single call for efficiency. Essential for drawing screen-aligned overlays, aim indicators, or distance markers on world objects.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "world_positions": {
                            "type": "array",
                            "description": "Array of 3D world positions to convert to screen coordinates",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "x": {
                                        "type": "number",
                                        "description": "World-space X coordinate in studs"
                                    },
                                    "y": {
                                        "type": "number",
                                        "description": "World-space Y coordinate in studs"
                                    },
                                    "z": {
                                        "type": "number",
                                        "description": "World-space Z coordinate in studs"
                                    }
                                },
                                "required": [
                                    "x",
                                    "y",
                                    "z"
                                ],
                                "additionalProperties": false
                            },
                            "minItems": 1,
                            "maxItems": 100
                        },
                        "return_on_screen_only": {
                            "type": "boolean",
                            "description": "If true, only return results for points that are actually on screen. Off-screen points are omitted from the response.",
                            "default": false
                        },
                        "include_depth": {
                            "type": "boolean",
                            "description": "Whether to include the depth (Z-distance from camera plane) for each converted point",
                            "default": false
                        }
                    },
                    "additionalProperties": false,
                    "required": [
                        "world_positions"
                    ]
                },
            },
            {
                name: "element_geometry_reader",
                description: "Reads the geometric and visual properties of specific GUI elements identified by path, class name, or text content. Returns AbsolutePosition, AbsoluteSize, BackgroundColor3, BorderColor3, BorderSizePixel, Transparency, Rotation, ZIndex, Visible state, and ClipsDescendants. Can target a single element by full path or batch query multiple elements by class name. Returns pixel-accurate screen coordinates for click automation or overlay alignment.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "query_mode": {
                            "type": "string",
                            "description": "How to identify target elements: by path (dot-separated instance hierarchy), by_class (all elements of a given class), by_text (elements containing specific text), or by_name (elements with a specific Name property)",
                            "enum": [
                                "by_path",
                                "by_class",
                                "by_text",
                                "by_name"
                            ]
                        },
                        "query_value": {
                            "type": "string",
                            "description": "The value to search for. For by_path: dot-separated path like CoreGui.Frame.TextLabel. For by_class: class name like TextLabel. For by_text: text substring match. For by_name: the Name property value.",
                            "minLength": 1,
                            "maxLength": 256
                        },
                        "root_container": {
                            "type": "string",
                            "description": "Top-level GUI container to constrain the search within",
                            "default": "CoreGui",
                            "enum": [
                                "CoreGui",
                                "PlayerGui",
                                "StarterGui",
                                "All"
                            ]
                        },
                        "include_children": {
                            "type": "boolean",
                            "description": "Whether to also return geometry for all direct children of matched elements",
                            "default": false
                        },
                        "only_visible": {
                            "type": "boolean",
                            "description": "Only return elements that are currently Visible",
                            "default": true
                        },
                        "max_results": {
                            "type": "integer",
                            "description": "Maximum number of elements to return",
                            "default": 50,
                            "minimum": 1,
                            "maximum": 500
                        }
                    },
                    "additionalProperties": false,
                    "required": [
                        "query_mode",
                        "query_value"
                    ]
                },
            },
            {
                name: "cursor_tracker",
                description: "Monitors the user's mouse cursor state including absolute and GUI-relative screen position, Icon type, and mouse-button press state. Can operate in one-shot (immediate read) or continuous tracking mode (streaming updates). In continuous mode, reports cursor position deltas and click events with timestamps. Useful for implementing click automation, cursor-aware overlays, or recording user interaction patterns.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "mode": {
                            "type": "string",
                            "description": "Tracking mode: read (one-shot immediate cursor state), start (begin continuous tracking), stop (end continuous tracking)",
                            "enum": [
                                "read",
                                "start",
                                "stop"
                            ]
                        },
                        "tracking_id": {
                            "type": "string",
                            "description": "Identifier for the tracking session. Required for stop. Auto-generated on start if omitted.",
                            "minLength": 1,
                            "maxLength": 64
                        },
                        "report_interval_ms": {
                            "type": "integer",
                            "description": "Interval in milliseconds between cursor position reports in continuous mode",
                            "default": 50,
                            "minimum": 16,
                            "maximum": 1000
                        },
                        "include_icon": {
                            "type": "boolean",
                            "description": "Whether to include the current mouse Icon type in reports",
                            "default": true
                        },
                        "include_buttons": {
                            "type": "boolean",
                            "description": "Whether to include mouse button press states (left, right, middle) in reports",
                            "default": true
                        },
                        "report_deltas": {
                            "type": "boolean",
                            "description": "Whether to include movement delta (change since last report) in continuous mode",
                            "default": false
                        },
                        "max_events": {
                            "type": "integer",
                            "description": "Maximum number of cursor events to collect in continuous mode before auto-stopping. 0 means unlimited.",
                            "default": 0,
                            "minimum": 0,
                            "maximum": 50000
                        }
                    },
                    "additionalProperties": false,
                    "required": [
                        "mode"
                    ]
                },
            },
            {
                name: "notification_hider",
                description: "Detects, hides, or suppresses in-game UI notifications, popups, toast messages, and modal dialogs. Supports scanning for common notification patterns (by class name, text content, or parent path) and marking them as hidden, destroyed, or repositioned off-screen. Can automatically block newly spawned notifications that match filter criteria for a specified duration. Also supports restoring previously hidden notifications.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "description": "Action to perform: scan (find and list all active notifications), hide (hide matching notifications), show (restore previously hidden notifications), destroy (remove matching notifications permanently), auto_block (start auto-blocking new matching notifications), stop_block (stop auto-blocking)",
                            "enum": [
                                "scan",
                                "hide",
                                "show",
                                "destroy",
                                "auto_block",
                                "stop_block"
                            ]
                        },
                        "notification_text_filter": {
                            "type": "string",
                            "description": "Optional text substring or regex pattern to match against notification text content. Only matching notifications are affected.",
                            "maxLength": 256
                        },
                        "class_filter": {
                            "type": "string",
                            "description": "Optional class name filter (e.g. Dialog, MessageDialog, NotificationAdornment). Only matching instances are affected.",
                            "maxLength": 64
                        },
                        "max_render_distance": {
                            "type": "integer",
                            "description": "Maximum screen distance from center beyond which notifications are hidden. In pixels.",
                            "default": 0,
                            "minimum": 0
                        },
                        "auto_block_duration": {
                            "type": "number",
                            "description": "Duration in seconds for auto_block mode to remain active. 0 means permanent until stopped.",
                            "default": 0,
                            "minimum": 0,
                            "maximum": 3600
                        },
                        "container_path": {
                            "type": "string",
                            "description": "Specific GUI container path to scan for notifications. Defaults to scanning all of CoreGui.",
                            "maxLength": 256
                        },
                        "include_dialogs": {
                            "type": "boolean",
                            "description": "Whether to also detect and act on modal dialog popups (not just toast notifications)",
                            "default": true
                        }
                    },
                    "additionalProperties": false,
                    "required": [
                        "action"
                    ]
                },
            },
            {
                name: "camera_controller",
                description: "Provides programmatic control over the game camera including locking to a target, unlocking, orbiting around a point, zooming in/out, and setting custom CFrame or CameraType. Supports smooth transitions with configurable tween duration and easing style. Can lock the camera to follow a specific character part (Head, Torso, HumanoidRootPart) or world position. Also supports first-person toggling and field-of-view adjustments.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "description": "Camera control action to execute",
                            "enum": [
                                "lock",
                                "unlock",
                                "orbit",
                                "zoom",
                                "set_cframe",
                                "set_fov",
                                "set_camera_type",
                                "first_person",
                                "third_person",
                                "reset"
                            ]
                        },
                        "target_identifier": {
                            "type": "string",
                            "description": "Target for lock/orbit actions: player name, part path, or world position identifier. Required for lock and orbit actions.",
                            "maxLength": 128
                        },
                        "target_part": {
                            "type": "string",
                            "description": "Specific character part to track when locking. Defaults to HumanoidRootPart.",
                            "default": "HumanoidRootPart",
                            "enum": [
                                "HumanoidRootPart",
                                "Head",
                                "Torso",
                                "UpperTorso",
                                "LowerTorso"
                            ]
                        },
                        "orbit_radius": {
                            "type": "number",
                            "description": "Distance in studs from the orbit center point",
                            "default": 15,
                            "minimum": 1,
                            "maximum": 500
                        },
                        "orbit_angle_horizontal": {
                            "type": "number",
                            "description": "Horizontal orbit angle in degrees",
                            "default": 0,
                            "minimum": -360,
                            "maximum": 360
                        },
                        "orbit_angle_vertical": {
                            "type": "number",
                            "description": "Vertical orbit angle in degrees",
                            "default": 30,
                            "minimum": -90,
                            "maximum": 90
                        },
                        "zoom_amount": {
                            "type": "number",
                            "description": "Zoom delta in studs. Positive zooms out, negative zooms in. Only for zoom action.",
                            "default": 5
                        },
                        "target_fov": {
                            "type": "integer",
                            "description": "Target Field of View in degrees. Only for set_fov action.",
                            "minimum": 1,
                            "maximum": 120
                        },
                        "camera_type": {
                            "type": "string",
                            "description": "CameraType to set. Only for set_camera_type action.",
                            "enum": [
                                "Fixed",
                                "Attach",
                                "Object",
                                "Custom",
                                "Follow",
                                "Orbit",
                                "Scriptable"
                            ]
                        },
                        "cframe_position": {
                            "type": "object",
                            "description": "Target world-space position for set_cframe action",
                            "properties": {
                                "x": {
                                    "type": "number"
                                },
                                "y": {
                                    "type": "number"
                                },
                                "z": {
                                    "type": "number"
                                }
                            },
                            "required": [
                                "x",
                                "y",
                                "z"
                            ]
                        },
                        "cframe_look_at": {
                            "type": "object",
                            "description": "World-space point for the camera to look at for set_cframe action",
                            "properties": {
                                "x": {
                                    "type": "number"
                                },
                                "y": {
                                    "type": "number"
                                },
                                "z": {
                                    "type": "number"
                                }
                            },
                            "required": [
                                "x",
                                "y",
                                "z"
                            ]
                        },
                        "transition_duration": {
                            "type": "number",
                            "description": "Duration in seconds for smooth camera transitions. 0 for instant.",
                            "default": 0.5,
                            "minimum": 0,
                            "maximum": 10
                        },
                        "easing_style": {
                            "type": "string",
                            "description": "Tween easing style for smooth transitions",
                            "default": "Sine",
                            "enum": [
                                "Linear",
                                "Sine",
                                "Quad",
                                "Quart",
                                "Quint",
                                "Expo",
                                "Elastic",
                                "Bounce"
                            ]
                        },
                        "disable_user_input": {
                            "type": "boolean",
                            "description": "Whether to disable user camera control input while the camera is locked",
                            "default": true
                        }
                    },
                    "additionalProperties": false,
                    "required": [
                        "action"
                    ]
                },
            },
            
            
            
            





            {
                name: "mouse_move_absolute",
                description: "Moves the mouse cursor to absolute screen coordinates (X, Y pixel position). Uses the primary monitor's coordinate system where (0,0) is the top-left corner. Supports optional smoothing and movement interpolation for more human-like cursor behavior.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "x": {
                            "type": "integer",
                            "description": "Target X coordinate in screen pixels, where 0 is the left edge of the primary monitor.",
                            "minimum": 0,
                            "maximum": 65535
                        },
                        "y": {
                            "type": "integer",
                            "description": "Target Y coordinate in screen pixels, where 0 is the top edge of the primary monitor.",
                            "minimum": 0,
                            "maximum": 65535
                        },
                        "smooth": {
                            "type": "boolean",
                            "description": "Whether to interpolate movement incrementally over multiple frames for a human-like cursor path. When false, cursor teleports instantly.",
                            "default": true
                        },
                        "duration_ms": {
                            "type": "integer",
                            "description": "Duration in milliseconds over which the movement should be spread when smooth is true. Minimum 16ms (approx 1 frame), maximum 5000ms.",
                            "default": 100,
                            "minimum": 16,
                            "maximum": 5000
                        },
                        "monitor_index": {
                            "type": "integer",
                            "description": "Index of the target monitor in a multi-monitor setup. 0-based. Defaults to primary monitor (index 0).",
                            "default": 0,
                            "minimum": 0,
                            "maximum": 15
                        }
                    },
                    "required": [
                        "x",
                        "y"
                    ],
                    "additionalProperties": false
                },
            },
            {
                name: "mouse_click_simulator",
                description: "Simulates a full mouse button click (down followed by up) at the current cursor position. Supports LeftButton, RightButton, MiddleButton, and extended mouse buttons (XButton1, XButton2). Each click generates both a down event and an up event with a configurable inter-event delay.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "button": {
                            "type": "string",
                            "description": "The mouse button to simulate a click on.",
                            "enum": [
                                "LeftButton",
                                "RightButton",
                                "MiddleButton",
                                "XButton1",
                                "XButton2"
                            ],
                            "default": "LeftButton"
                        },
                        "hold_duration_ms": {
                            "type": "integer",
                            "description": "Duration in milliseconds to hold the button down before releasing. Minimum 1ms, maximum 10000ms.",
                            "default": 50,
                            "minimum": 1,
                            "maximum": 10000
                        },
                        "x": {
                            "type": "integer",
                            "description": "Optional X coordinate to move to before clicking. When omitted, clicks at the current cursor position.",
                            "minimum": 0,
                            "maximum": 65535
                        },
                        "y": {
                            "type": "integer",
                            "description": "Optional Y coordinate to move to before clicking. Must be provided together with x.",
                            "minimum": 0,
                            "maximum": 65535
                        },
                        "click_count": {
                            "type": "integer",
                            "description": "Number of consecutive clicks to simulate (useful for double/triple-click).",
                            "default": 1,
                            "minimum": 1,
                            "maximum": 10
                        },
                        "inter_click_delay_ms": {
                            "type": "integer",
                            "description": "Delay in milliseconds between consecutive clicks when click_count > 1.",
                            "default": 100,
                            "minimum": 10,
                            "maximum": 5000
                        }
                    },
                    "required": [],
                    "additionalProperties": false
                },
            },
            {
                name: "mouse_button_hold",
                description: "Simulates pressing and holding a mouse button down, or releasing a held button. Use this for drag-and-drop preparation, continuous selection, or any scenario requiring sustained button pressure. The hold persists until a corresponding release call or timeout.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "button": {
                            "type": "string",
                            "description": "The mouse button to press or release.",
                            "enum": [
                                "LeftButton",
                                "RightButton",
                                "MiddleButton",
                                "XButton1",
                                "XButton2"
                            ],
                            "default": "LeftButton"
                        },
                        "action": {
                            "type": "string",
                            "description": "Whether to press down or release up the specified button.",
                            "enum": [
                                "down",
                                "up"
                            ],
                            "default": "down"
                        },
                        "x": {
                            "type": "integer",
                            "description": "Optional X coordinate to move to before performing the action.",
                            "minimum": 0,
                            "maximum": 65535
                        },
                        "y": {
                            "type": "integer",
                            "description": "Optional Y coordinate to move to before performing the action.",
                            "minimum": 0,
                            "maximum": 65535
                        },
                        "hold_token": {
                            "type": "string",
                            "description": "Unique identifier for tracking this hold operation. Required for targeted release when multiple buttons are held simultaneously. Auto-generated if omitted.",
                            "minLength": 1,
                            "maxLength": 64
                        }
                    },
                    "required": [
                        "action"
                    ],
                    "additionalProperties": false
                },
            },
            
            {
                name: "scroll_wheel_simulator",
                description: "Simulates mouse scroll wheel input in both vertical and horizontal directions. Supports discrete tick increments for precise scrolling and continuous smooth scrolling for fluid page navigation. Can target a specific window region for focused scroll operations.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "direction": {
                            "type": "string",
                            "description": "Scroll direction: 'vertical' for up/down scrolling, 'horizontal' for left/right (tilt-wheel) scrolling.",
                            "enum": [
                                "vertical",
                                "horizontal"
                            ],
                            "default": "vertical"
                        },
                        "delta": {
                            "type": "integer",
                            "description": "Scroll amount in wheel ticks (positive = up/right, negative = down/left). Each tick typically represents 3-4 lines of text or ~30-40 pixels of scroll distance.",
                            "default": 1,
                            "minimum": -120,
                            "maximum": 120
                        },
                        "smooth": {
                            "type": "boolean",
                            "description": "When true, generates incremental scroll events for smooth continuous scrolling instead of discrete ticks.",
                            "default": false
                        },
                        "x": {
                            "type": "integer",
                            "description": "Optional X screen coordinate for the scroll operation, which scrolls the content under that position.",
                            "minimum": 0,
                            "maximum": 65535
                        },
                        "y": {
                            "type": "integer",
                            "description": "Optional Y screen coordinate for the scroll operation.",
                            "minimum": 0,
                            "maximum": 65535
                        }
                    },
                    "required": [],
                    "additionalProperties": false
                },
            },
            {
                name: "key_press_emitter",
                description: "Simulates pressing and releasing a single keyboard key identified by its KeyCode. Generates a key-down event followed by a key-up event with a configurable delay between them. Supports all standard keyboard keys including letters, numbers, function keys, modifiers, and navigation keys.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "key_code": {
                            "type": "string",
                            "description": "The Roblox KeyCode enum value identifying the key to press. Examples include 'A', 'B', 'Space', 'Enter', 'Escape', 'LeftShift', 'F1', 'One', 'Minus', 'Comma'.",
                            "minLength": 1,
                            "maxLength": 32
                        },
                        "hold_duration_ms": {
                            "type": "integer",
                            "description": "Duration in milliseconds between key-down and key-up events. Minimum 5ms, maximum 30000ms.",
                            "default": 50,
                            "minimum": 5,
                            "maximum": 30000
                        },
                        "suppress_modifier": {
                            "type": "boolean",
                            "description": "When true, temporarily suppresses modifier keys (Shift, Ctrl, Alt) to prevent unexpected character transformations during the press.",
                            "default": false
                        }
                    },
                    "required": [
                        "key_code"
                    ],
                    "additionalProperties": false
                },
            },
            {
                name: "key_hold_controller",
                description: "Holds a keyboard key down for a specified duration and then automatically releases it. Useful for continuous actions like walking forward (holding 'W') or charging abilities. Supports multiple simultaneous key holds with independent release tracking via a hold token.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "key_code": {
                            "type": "string",
                            "description": "The Roblox KeyCode enum value identifying the key to hold down.",
                            "minLength": 1,
                            "maxLength": 32
                        },
                        "action": {
                            "type": "string",
                            "description": "Whether to press down, release up, or press-and-hold for a duration.",
                            "enum": [
                                "down",
                                "up",
                                "hold"
                            ],
                            "default": "hold"
                        },
                        "duration_ms": {
                            "type": "integer",
                            "description": "Duration in milliseconds to hold the key when action is 'hold'. After this duration, the key is automatically released.",
                            "default": 1000,
                            "minimum": 50,
                            "maximum": 600000,
                        },
                        "hold_token": {
                            "type": "string",
                            "description": "Optional unique identifier for tracking this hold. Required to release a specific held key when multiple keys are held simultaneously. Auto-generated if omitted.",
                            "minLength": 1,
                            "maxLength": 64
                        }
                    },
                    "required": [
                        "key_code"
                    ],
                    "additionalProperties": false
                },
            },
            {
                name: "text_automated_typer",
                description: "Types a string of text character-by-character with configurable per-character delay, simulating human keyboard input. Supports multi-line strings and special character handling. Can optionally press Enter after the text and randomize the typing speed profile for stealth purposes.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "text": {
                            "type": "string",
                            "description": "The full text string to type. Supports letters, numbers, punctuation, spaces, and newlines. Maximum 10000 characters.",
                            "minLength": 1,
                            "maxLength": 10000
                        },
                        "delay_per_char_ms": {
                            "type": "integer",
                            "description": "Base delay in milliseconds between each character typed. Actual delay is randomized within +/-30% when variance is enabled.",
                            "default": 50,
                            "minimum": 1,
                            "maximum": 5000
                        },
                        "press_enter_after": {
                            "type": "boolean",
                            "description": "Whether to simulate pressing the Enter key after typing all characters.",
                            "default": false
                        },
                        "humanize_delay": {
                            "type": "boolean",
                            "description": "When true, adds realistic timing variance to keystroke intervals to mimic human typing patterns.",
                            "default": true
                        },
                        "error_probability": {
                            "type": "number",
                            "description": "Probability (0.0 to 1.0) of simulating a typo for each character (backspace + retype), mimicking human typing mistakes.",
                            "default": 0,
                            "minimum": 0,
                            "maximum": 0.5
                        }
                    },
                    "required": [
                        "text"
                    ],
                    "additionalProperties": false
                },
            },
            {
                name: "macro_recorder",
                description: "Records a sequence of mouse and keyboard input events into a named macro for later replay. Captures event types, positions, timestamps, and relative delays between events. Supports filtering to record only specific event types and setting a maximum recording duration.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "macro_name": {
                            "type": "string",
                            "description": "Unique name for the recorded macro. Used as the identifier for replay and management operations.",
                            "minLength": 1,
                            "maxLength": 128,
                            "pattern": "^[a-zA-Z0-9_\\-]+$"
                        },
                        "record_mouse": {
                            "type": "boolean",
                            "description": "When true, captures mouse move, click, scroll, and drag events during recording.",
                            "default": true
                        },
                        "record_keyboard": {
                            "type": "boolean",
                            "description": "When true, captures keyboard key press and release events during recording.",
                            "default": true
                        },
                        "max_duration_seconds": {
                            "type": "integer",
                            "description": "Maximum recording duration in seconds. Recording stops automatically when this limit is reached.",
                            "default": 300,
                            "minimum": 1,
                            "maximum": 3600
                        },
                        "capture_absolute_coordinates": {
                            "type": "boolean",
                            "description": "When true, records absolute screen coordinates for mouse events. When false, records relative offsets from the current cursor position.",
                            "default": true
                        },
                        "start_delay_ms": {
                            "type": "integer",
                            "description": "Delay in milliseconds before recording begins, to allow time to switch to the target application.",
                            "default": 1000,
                            "minimum": 0,
                            "maximum": 30000
                        }
                    },
                    "required": [
                        "macro_name"
                    ],
                    "additionalProperties": false
                },
            },
            {
                name: "macro_replayer",
                description: "Replays a previously recorded macro sequence of mouse and keyboard events. Executes each captured event with the original timing and delays, optionally supporting speed adjustment and loop count. Can replay the macro synchronously (blocking) or asynchronously (fire-and-forget).",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "macro_name": {
                            "type": "string",
                            "description": "Name of the previously recorded macro to replay. Must match an existing macro name exactly.",
                            "minLength": 1,
                            "maxLength": 128
                        },
                        "speed_multiplier": {
                            "type": "number",
                            "description": "Multiplier for replay speed relative to original recording. 2.0 = twice as fast, 0.5 = half speed. Inter-event delays are divided by this value.",
                            "default": 1,
                            "minimum": 0.1,
                            "maximum": 10
                        },
                        "loop_count": {
                            "type": "integer",
                            "description": "Number of times to replay the macro in sequence. Use 0 for infinite looping until stopped.",
                            "default": 1,
                            "minimum": 0,
                            "maximum": 999999
                        },
                        "mode": {
                            "type": "string",
                            "description": "Execution mode: 'synchronous' waits for the macro to complete before returning, 'async' starts replay and returns immediately.",
                            "enum": [
                                "synchronous",
                                "async"
                            ],
                            "default": "synchronous"
                        },
                        "loop_delay_ms": {
                            "type": "integer",
                            "description": "Delay in milliseconds between consecutive loops when loop_count > 1 or loop_count is 0.",
                            "default": 0,
                            "minimum": 0,
                            "maximum": 60000
                        },
                        "stop_token": {
                            "type": "string",
                            "description": "Optional token used to stop an async or infinite replay from another tool call.",
                            "minLength": 1,
                            "maxLength": 64
                        }
                    },
                    "required": [
                        "macro_name"
                    ],
                    "additionalProperties": false
                },
            },
            {
                name: "character_motion_controller",
                description: "Automates Roblox character movement by simulating directional key inputs (WASD) to navigate to specified world coordinates or waypoints. Supports sprint toggling, jump integration, and obstacle avoidance timing. Can queue multiple waypoints for path following.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "target_x": {
                            "type": "number",
                            "description": "Target world X coordinate for the character to move toward. Uses the game's 3D world coordinate system.",
                            "minimum": -999999,
                            "maximum": 999999
                        },
                        "target_z": {
                            "type": "number",
                            "description": "Target world Z coordinate for the character to move toward. Depth axis in the game's 3D world coordinate system.",
                            "minimum": -999999,
                            "maximum": 999999
                        },
                        "target_y": {
                            "type": "number",
                            "description": "Optional target Y coordinate (vertical/height). When omitted, maintains current height or navigates terrain naturally.",
                            "minimum": -999999,
                            "maximum": 999999
                        },
                        "sprint": {
                            "type": "boolean",
                            "description": "When true, holds the LeftShift modifier for sprinting while moving.",
                            "default": false
                        },
                        "jump_at_end": {
                            "type": "boolean",
                            "description": "When true, simulates a jump (Space key press) upon reaching the destination.",
                            "default": false
                        },
                        "arrival_tolerance": {
                            "type": "number",
                            "description": "Distance in world units from the target position considered as 'arrived'. Prevents micro-adjustments from jittering movement keys.",
                            "default": 3,
                            "minimum": 0.1,
                            "maximum": 50
                        },
                        "max_duration_seconds": {
                            "type": "integer",
                            "description": "Maximum time in seconds to attempt reaching the waypoint before stopping movement and returning.",
                            "default": 30,
                            "minimum": 1,
                            "maximum": 600
                        },
                        "waypoints": {
                            "type": "array",
                            "description": "Optional ordered list of intermediate waypoints to navigate through sequentially before reaching the final target. Each waypoint is a coordinate triplet.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "x": {
                                        "type": "number",
                                        "description": "Waypoint X coordinate"
                                    },
                                    "z": {
                                        "type": "number",
                                        "description": "Waypoint Z coordinate"
                                    },
                                    "y": {
                                        "type": "number",
                                        "description": "Optional waypoint Y coordinate"
                                    }
                                },
                                "required": [
                                    "x",
                                    "z"
                                ],
                                "additionalProperties": false
                            },
                            "minItems": 1,
                            "maxItems": 100
                        }
                    },
                    "required": [
                        "target_x",
                        "target_z"
                    ],
                    "additionalProperties": false
                },
            },
            {
                name: "touch_input_simulator",
                description: "Simulates touch input events on Roblox ScreenGuis and 3D surfaces. Supports single-touch gestures including tap, long-press, swipe, and pinch. Uses normalized screen coordinates (0.0-1.0) matching Roblox's UDim2 scale system for device-independent positioning.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "description": "The type of touch gesture to simulate.",
                            "enum": [
                                "tap",
                                "long_press",
                                "swipe",
                                "pinch"
                            ],
                            "default": "tap"
                        },
                        "x": {
                            "type": "number",
                            "description": "Normalized X coordinate (0.0 = left edge, 1.0 = right edge) matching Roblox's UDim2 scale system.",
                            "minimum": 0,
                            "maximum": 1
                        },
                        "y": {
                            "type": "number",
                            "description": "Normalized Y coordinate (0.0 = top edge, 1.0 = bottom edge) matching Roblox's UDim2 scale system.",
                            "minimum": 0,
                            "maximum": 1
                        },
                        "touch_id": {
                            "type": "integer",
                            "description": "Finger/pointer identifier for multi-touch scenarios. Each concurrent touch should have a unique ID starting from 0.",
                            "default": 0,
                            "minimum": 0,
                            "maximum": 10
                        },
                        "hold_duration_ms": {
                            "type": "integer",
                            "description": "Duration in milliseconds to hold the touch down (for long_press action only).",
                            "default": 1000,
                            "minimum": 100,
                            "maximum": 10000
                        },
                        "end_x": {
                            "type": "number",
                            "description": "Normalized X coordinate for the swipe or pinch end position.",
                            "minimum": 0,
                            "maximum": 1
                        },
                        "end_y": {
                            "type": "number",
                            "description": "Normalized Y coordinate for the swipe or pinch end position.",
                            "minimum": 0,
                            "maximum": 1
                        },
                        "swipe_duration_ms": {
                            "type": "integer",
                            "description": "Duration in milliseconds for the swipe gesture from start to end position.",
                            "default": 300,
                            "minimum": 16,
                            "maximum": 5000
                        }
                    },
                    "required": [
                        "action",
                        "x",
                        "y"
                    ],
                    "additionalProperties": false
                },
            },
            {
                name: "ui_element_clicker",
                description: "Clicks at the absolute screen position of a specific GUI element by name or path identifier. Uses Roblox's GUI hierarchy to resolve element positions and dimensions before performing the click. Supports absolute offset adjustment for clicking sub-elements within larger containers.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "element_path": {
                            "type": "string",
                            "description": "Path to the GUI element, using dot-notation from the PlayerGui root (e.g., 'ScreenGui.Frame.Button'). Case-sensitive.",
                            "minLength": 1,
                            "maxLength": 512
                        },
                        "button": {
                            "type": "string",
                            "description": "Mouse button to use for the click on the UI element.",
                            "enum": [
                                "LeftButton",
                                "RightButton",
                                "MiddleButton"
                            ],
                            "default": "LeftButton"
                        },
                        "offset_x": {
                            "type": "integer",
                            "description": "Pixel offset to add to the element's center X position. Positive values shift right, negative shift left. Useful for clicking specific sub-regions.",
                            "default": 0,
                            "minimum": -5000,
                            "maximum": 5000
                        },
                        "offset_y": {
                            "type": "integer",
                            "description": "Pixel offset to add to the element's center Y position. Positive values shift down, negative shift up.",
                            "default": 0,
                            "minimum": -5000,
                            "maximum": 5000
                        },
                        "wait_for_element_ms": {
                            "type": "integer",
                            "description": "Maximum time in milliseconds to wait for the element to exist and become visible before proceeding. Returns error if element is not found within this window.",
                            "default": 5000,
                            "minimum": 0,
                            "maximum": 30000
                        },
                        "click_type": {
                            "type": "string",
                            "description": "Type of click to perform on the element: 'single' click, 'double' click, or 'right_click'.",
                            "enum": [
                                "single",
                                "double",
                                "right_click"
                            ],
                            "default": "single"
                        }
                    },
                    "required": [
                        "element_path"
                    ],
                    "additionalProperties": false
                },
            },
            





            {
                name: "property_mutator_generic",
                description: "Set any writable property on any game instance resolved by path or reference. Accepts a map of property names to values supporting strings, numbers, booleans, Color3, Vector3, CFrame, UDim2, and other Roblox types via serialized notation. Validates that the target instance exists and that the property is writable before applying changes. Returns the previous values of all modified properties for easy rollback.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "target_path": {
                            "type": "string",
                            "description": "Full Luau path to the target instance, e.g. \"game.Workspace.Part\" or \"game:GetService(\\\"Lighting\\\")\".",
                            "examples": [
                                "game.Workspace.Baseplate",
                                "game:GetService(\"Lighting\")",
                                "game.Players.LocalPlayer.Character.Humanoid"
                            ]
                        },
                        "property_list": {
                            "type": "array",
                            "description": "Array of property names to read from the target instance (e.g. '[\"WalkSpeed\",\"JumpPower\",\"Health\"]' or omitted for Name+ClassName only).",
                            "items": {
                                "type": "string"
                            },
                            "default": []
                        },
                        "auto_serialize": {
                            "type": "boolean",
                            "description": "If true, attempt to auto-parse Roblox types from string representations without requiring Luau syntax.",
                            "default": true
                        }
                    },
                    "required": [
                        "target_path",
                        "properties"
                    ]
                },
            },
            {
                name: "instance_factory",
                description: "Create a new Instance of any Roblox class and optionally parent it into the game tree. Supports all class types from BasePart and BillboardGui to ScreenGui, Tool, and custom classes. Allows setting initial properties atomically at creation time. Returns the full path and ClassName of the created instance for subsequent reference.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "class_name": {
                            "type": "string",
                            "description": "The Roblox class name to instantiate (e.g. \"Part\", \"ScreenGui\", \"Tool\", \"Model\", \"RemoteEvent\", \"StringValue\"). Must be a valid Roblox engine class.",
                            "examples": [
                                "Part",
                                "ScreenGui",
                                "RemoteEvent",
                                "Model",
                                "BindableEvent",
                                "Tool"
                            ]
                        },
                        "parent_path": {
                            "type": "string",
                            "description": "Full path to the parent instance, e.g. \"game.Workspace\" or \"game:GetService(\\\"ReplicatedStorage\\\")\".",
                            "examples": [
                                "game.Workspace",
                                "game:GetService(\"ReplicatedStorage\")",
                                "game.Players.LocalPlayer.PlayerGui"
                            ]
                        },
                        "property_map": {
                            "type": "string",
                            "description": "JSON string of initial property values for the new instance (e.g. '{\"Size\":[0,2,0,2],\"Position\":[0.5,0,0.5,0],\"Color\":[1,0,0]}'). Empty/null = defaults."
                        },
                        "instance_name": {
                            "type": "string",
                            "description": "Optional custom Name for the new instance. If omitted, Roblox assigns a default name like \"Part\" or \"Model\".",
                            "maxLength": 100
                        },
                        "archivable": {
                            "type": "boolean",
                            "description": "Set the Archivable property on creation, controlling whether the instance can be cloned.",
                            "default": true
                        }
                    },
                    "required": [
                        "class_name",
                        "parent_path"
                    ]
                },
            },
            {
                name: "instance_terminator",
                description: "Destroy or remove one or more game instances from the instance hierarchy. Supports single destruction by path, bulk destruction by class filter within a container, or targeted removal of specific children. Optionally moves instances to nil instead of destroying them, allowing later recovery. Returns a confirmation of what was destroyed and the count of affected instances.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "target_paths": {
                            "type": "array",
                            "items": {
                                "type": "string"
                            },
                            "description": "Array of full Luau paths to instances to destroy, e.g. [\"game.Workspace.Decal233\", \"game.Workspace.Folder\"]. Mutually exclusive with container_path.",
                            "examples": [
                                [
                                    "game.Workspace.SpawnLocation1",
                                    "game.Workspace.SpawnLocation2"
                                ]
                            ]
                        },
                        "container_path": {
                            "type": "string",
                            "description": "When set, destroys all children matching class_filter within this container. Mutually exclusive with target_paths.",
                            "examples": [
                                "game.Workspace",
                                "game:GetService(\"ReplicatedStorage\").Assets"
                            ]
                        },
                        "class_filter": {
                            "type": "string",
                            "description": "Only destroy children matching this class name. Used with container_path. Leave empty to destroy all children.",
                            "examples": [
                                "Part",
                                "Model",
                                "Decal",
                                "SpawnLocation"
                            ]
                        },
                        "move_to_nil": {
                            "type": "boolean",
                            "description": "If true, reparent to nil (game.Nil) instead of calling Destroy(), allowing later recovery via restore.",
                            "default": false
                        },
                        "also_destroy_descendants": {
                            "type": "boolean",
                            "description": "If true and the target is a Model or Folder, recursively destroy all descendants as well.",
                            "default": true
                        },
                        "max_to_destroy": {
                            "type": "number",
                            "description": "Maximum number of instances to destroy in a single call (0 = unlimited). Prevents accidental mass destruction.",
                            "default": 100,
                            "minimum": 0,
                            "maximum": 10000
                        }
                    },
                    "anyOf": [
                        {
                            "required": [
                                "target_paths"
                            ]
                        },
                        {
                            "required": [
                                "container_path"
                            ]
                        }
                    ]
                },
            },
            {
                name: "instance_duplicator",
                description: "Clone or deep-copy one or more instances in the game tree. Supports duplicating to a new parent, offsetting the clone's position (for BaseParts), renaming the copy, and optionally cloning descendant trees. Uses Roblox's built-in Clone() method for reliability. Returns the path of each newly created clone.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "source_path": {
                            "type": "string",
                            "description": "Full Luau path to the instance to clone, e.g. \"game.Workspace.MyModel\" or \"game:GetService(\\\"ReplicatedStorage\\\").Weapon\".",
                            "examples": [
                                "game.Workspace.RewardPart",
                                "game:GetService(\"ReplicatedStorage\").Assets.Chest"
                            ]
                        },
                        "new_name": {
                            "type": "string",
                            "description": "Optional new Name for the cloned instance. If omitted, appends \"Clone\" to the original name.",
                            "maxLength": 100
                        },
                        "parent_path": {
                            "type": "string",
                            "description": "Full path where the clone should be parented. If omitted, parents to the same location as the source.",
                            "examples": [
                                "game.Workspace",
                                "game.Players.LocalPlayer.Backpack"
                            ]
                        },
                        "position_offset": {
                            "type": "object",
                            "properties": {
                                "x": {
                                    "type": "number",
                                    "description": "X offset in studs."
                                },
                                "y": {
                                    "type": "number",
                                    "description": "Y offset in studs."
                                },
                                "z": {
                                    "type": "number",
                                    "description": "Z offset in studs."
                                }
                            },
                            "description": "If the source is a BasePart or has a PrimaryPart, apply this CFrame offset to the clone's position.",
                            "additionalProperties": false
                        },
                        "deep_copy_descendants": {
                            "type": "boolean",
                            "description": "If true, clone the full descendant tree. If false, only clone the top-level instance and its direct properties.",
                            "default": true
                        },
                        "count": {
                            "type": "number",
                            "description": "Number of times to duplicate. Creates multiple sequential clones with auto-incremented names.",
                            "default": 1,
                            "minimum": 1,
                            "maximum": 100
                        }
                    },
                    "required": [
                        "source_path"
                    ]
                },
            },
            
            
            
            
            
            
            
            
            {
                name: "chat_system_controller",
                description: "Control chat system properties including DefaultChat properties, bubble chat, chat window visibility, message filtering bypass, and ChatService configuration. Can disable chat filters, force message colors, set chat window scale, hide or show the chat UI, broadcast fake system messages, and modify BubbleChat settings. Returns current chat configuration.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": [
                                "modify_default_chat",
                                "send_system_message",
                                "bypass_filter",
                                "set_bubble_chat",
                                "disable_chat",
                                "enable_chat",
                                "configure_chat_service"
                            ],
                            "description": "modify_default_chat = change DefaultChatSystemChatFeatures properties; send_system_message = broadcast a fake system message to all or specific players; bypass_filter = send chat messages that bypass the text filter; set_bubble_chat = toggle/modify BubbleChat appearance; disable_chat = hide chat entirely; enable_chat = restore chat; configure_chat_service = modify ChatService settings.",
                            "default": "modify_default_chat"
                        },
                        "chat_visible": {
                            "type": "boolean",
                            "description": "Toggle chat window visibility.",
                            "default": true
                        },
                        "bubble_chat_enabled": {
                            "type": "boolean",
                            "description": "Toggle bubble chat above player characters.",
                            "default": true
                        },
                        "chat_window_scale": {
                            "type": "number",
                            "description": "Scale factor for the chat window UI (0.5 to 3).",
                            "minimum": 0.5,
                            "maximum": 3,
                            "default": 1
                        },
                        "message_color": {
                            "type": "string",
                            "description": "Force all chat messages to a specific Color3 value. Overrides player-assigned colors.",
                            "examples": [
                                "Color3.fromRGB(255, 200, 100)",
                                "#FFC864"
                            ]
                        },
                        "message_text": {
                            "type": "string",
                            "description": "Text content for send_system_message or a fake message.",
                            "maxLength": 500
                        },
                        "extra_data": {
                            "type": "string",
                            "description": "JSON string of additional data for chat message manipulation (e.g. '{\"FromSpeaker\":\"System\",\"ChannelName\":\"All\"}'). Empty/null = no extra data."
                        },
                        "disable_text_filter": {
                            "type": "boolean",
                            "description": "Bypass the TextService/chat filter for messages sent through this tool.",
                            "default": false
                        },
                        "chat_service_path": {
                            "type": "string",
                            "description": "Full path to the ChatService or chat configuration. Auto-resolved by default.",
                            "examples": [
                                "game:GetService(\"Chat\")"
                            ]
                        },
                        "reset_on_spawn": {
                            "type": "boolean",
                            "description": "Whether chat settings should persist through character respawns.",
                            "default": false
                        }
                    },
                    "required": [
                        "action"
                    ]
                },
            },
            
            
            {
                name: "modify_local_property",
                description: "Instantly modify LocalPlayer or Character properties. Supports WalkSpeed, JumpPower, HipHeight, Health, MaxHealth, Noclip (walk through walls), InfiniteJump, and Workspace Gravity. Optionally revert after N seconds.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "property_map": {
                            "type": "string",
                            "description": "JSON string of properties to modify (e.g. '{\"WalkSpeed\":50,\"JumpPower\":100,\"Noclip\":true,\"InfiniteJump\":true}'). Empty/null = no changes."
                        },
                        "duration": {
                            "type": "number",
                            "description": "Duration in seconds before reverting changes (0 = permanent)",
                            "default": 0
                        }
                    },
                    "required": [
                        "properties"
                    ]
                },
            },





            {
                name: "script_source_ripper",
                description: "Extracts the raw source code of any Roblox script object (Script, ModuleScript, LocalScript) at runtime by reading the compiled bytecode and decompiling it back to human-readable Luau source. This tool circumvents the 'Source is not available' restriction by leveraging internal VM methods such as debug.info and decompilation of loaded closure prototypes. Handles both scripts embedded in instances and scripts loaded into the Lua VM module cache. Returns the full source as a string along with metadata including the script container path, identity level, and whether the source was reconstructed from bytecode or read directly.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "target_path": {
                            "type": "string",
                            "description": "Hierarchical DataModel path to the target script instance, e.g. 'game.Workspace.MyScript' or 'game.ReplicatedStorage.Modules.MainModule'. Accepts dot-separated and colon-separated notations.",
                            "examples": [
                                "game.ReplicatedStorage.MainModule",
                                "game.ServerScriptService.GameManager"
                            ]
                        },
                        "object_reference": {
                            "type": "string",
                            "description": "Optional in-memory pointer or object identifier of the target script, used when the script is not enumerated in the DataModel tree (e.g. a dynamically created ModuleScript instance from the Lua registry).",
                            "examples": [
                                "0x7ff23c010b70"
                            ]
                        },
                        "decompilation_mode": {
                            "type": "string",
                            "description": "Decompilation strategy. 'auto' selects the best available decompiler for the bytecode version. 'vanilla' uses standard Luau decompilation. 'aggressive' reconstructs variable names and control flow heuristically. Default is 'auto'.",
                            "enum": [
                                "auto",
                                "vanilla",
                                "aggressive"
                            ],
                            "default": "auto"
                        },
                        "include_bytecode": {
                            "type": "boolean",
                            "description": "When true, also returns the raw Luau bytecode alongside the decompiled source for inspection. Default is false.",
                            "default": false
                        }
                    },
                    "required": [
                        "target_path"
                    ]
                },
            },
            {
                name: "function_interceptor_installer",
                description: "Installs a hook on any global Luau function or Instance method by overwriting its closure pointer or detouring the function's entry point in the VM. Supports pre-hooks (execute before the original), post-hooks (execute after the original), and replace-hooks (execute instead of the original). The hook callback can inspect arguments, modify return values, or conditionally call the original function. Provides automatic stack unwinding protection and identity-level spoofing to avoid detection by tamper-evident checks.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "target": {
                            "type": "string",
                            "description": "Fully qualified name or descriptor of the function to hook. For globals use format 'global.FunctionName', for Instance methods use 'InstanceType:MethodName', for module exports use 'ModuleName.ExportName'. Examples: 'game:GetService', 'Instance:Clone', 'global.warn'.",
                            "examples": [
                                "game:GetService",
                                "Instance:Destroy",
                                "global.warn",
                                "script:GetFullName"
                            ]
                        },
                        "hook_type": {
                            "type": "string",
                            "description": "Type of hook to install. 'pre' executes the callback before the original function with the same arguments. 'post' executes the callback after the original function with its return values. 'replace' substitutes the original function entirely.",
                            "enum": [
                                "pre",
                                "post",
                                "replace"
                            ],
                            "default": "pre"
                        },
                        "callback_source": {
                            "type": "string",
                            "description": "Luau source code string defining the hook callback function. The callback receives arguments depending on hook_type: pre-hooks receive '(name, ...args)', post-hooks receive '(name, ...results)', replace-hooks receive '(name, ...args)' and must return values. Use the 'yield' variable to optionally call the original: 'yield(...)'.",
                            "examples": [
                                "return function(name, ...) warn(\"GetService called:\", name) return yield(...) end"
                            ]
                        },
                        "identity_spoof": {
                            "type": "integer",
                            "description": "Optional identity level to impersonate when the hook executes. 0-10 scale where higher values bypass more restrictions. If not specified, uses the calling context identity.",
                            "minimum": 0,
                            "maximum": 10
                        },
                        "oneshot": {
                            "type": "boolean",
                            "description": "When true, the hook fires once and automatically removes itself after invocation. Default is false.",
                            "default": false
                        }
                    },
                    "required": [
                        "target",
                        "hook_type",
                        "callback_source"
                    ]
                },
            },
            
            
            {
                name: "metatable_seer",
                description: "Inspects the metatable of any Roblox Instance, Lua table, or userdata object, revealing all metamethods including hidden or dynamically assigned ones. Displays each metamethod's key, value type, and a preview of its contents if it is a function. Can recursively walk metatable chains to expose inherited metamethods from parent metatables. Also detects common security patterns such as locked metatables, protected __namecall handlers, and metatable tunneling through the registry.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "target_path": {
                            "type": "string",
                            "description": "Path or reference to the object whose metatable should be inspected. Accepts a DataModel path (e.g. 'game.Workspace.Part'), a Lua global (e.g. 'global._G'), a registry object (e.g. 'registry.0x7ff2'), or a type name (e.g. 'type.Instance').",
                            "examples": [
                                "game.Players",
                                "global._G",
                                "registry.module_cache",
                                "type.Instance"
                            ]
                        },
                        "depth": {
                            "type": "integer",
                            "description": "Maximum depth to walk the metatable chain. A depth of 1 inspects only the direct metatable. Higher values traverse __index and __metatable chains recursively. Default is 1, max is 10.",
                            "minimum": 1,
                            "maximum": 10,
                            "default": 1
                        },
                        "include_hidden": {
                            "type": "boolean",
                            "description": "When true, attempts to bypass locked or hidden metatables (those protected with __metatable or via C-level locking) and read the true underlying metatable. Default is false.",
                            "default": false
                        },
                        "show_functions": {
                            "type": "boolean",
                            "description": "When true, prints the first 200 characters of each metamethod function source for analysis. Default is true.",
                            "default": true
                        },
                        "object_reference": {
                            "type": "string",
                            "description": "Optional raw memory reference to the object if it cannot be addressed by path.",
                            "examples": [
                                "0x7ff23c010b70"
                            ]
                        }
                    },
                    "required": [
                        "target_path"
                    ]
                },
            },
            {
                name: "metatable_modifier",
                description: "Sets, replaces, or removes specific metamethods on any object's metatable, including __index, __newindex, __call, __namecall, __tostring, __gc, and custom metamethods. Can create a new metatable on objects that do not have one, or modify an existing metatable. Includes protection override capabilities for locked metatables. Validates that the new metamethod is callable and logs any modifications for traceability. Supports atomic batch operations to set multiple metamethods in a single transaction.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "target_path": {
                            "type": "string",
                            "description": "Path or reference to the object whose metatable will be modified. Accepts DataModel paths, globals, or registry references.",
                            "examples": [
                                "game.Players.LocalPlayer",
                                "global.string",
                                "registry.0x7ff2"
                            ]
                        },
                        "metamethods": {
                            "type": "array",
                            "description": "Array of metamethod modifications to apply. Each entry specifies the metamethod key, the operation type (set, replace, remove), and the new value if applicable.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "key": {
                                        "type": "string",
                                        "description": "The metamethod name without double underscores, e.g. 'index', 'newindex', 'call', 'namecall'. The tool automatically prepends '__' if not provided.",
                                        "examples": [
                                            "index",
                                            "newindex",
                                            "call",
                                            "namecall",
                                            "tostring",
                                            "gc"
                                        ]
                                    },
                                    "operation": {
                                        "type": "string",
                                        "description": "Operation to perform on this metamethod. 'set' creates or overwrites the metamethod. 'replace' only overwrites if it already exists. 'remove' deletes the metamethod entry.",
                                        "enum": [
                                            "set",
                                            "replace",
                                            "remove"
                                        ]
                                    },
                                    "value_source": {
                                        "type": "string",
                                        "description": "Luau source code for the function to set as the metamethod. Use %original% as a placeholder to reference the previous metamethod value. Required for set and replace operations, ignored for remove.",
                                        "examples": [
                                            "return function(self, key) return rawget(self, key) end"
                                        ]
                                    }
                                },
                                "required": [
                                    "key",
                                    "operation"
                                ]
                            },
                            "minItems": 1,
                            "maxItems": 20
                        },
                        "create_if_missing": {
                            "type": "boolean",
                            "description": "When true, creates a new metatable on the object if it does not already have one. Default is true.",
                            "default": true
                        },
                        "bypass_protection": {
                            "type": "boolean",
                            "description": "When true, attempts to bypass metatable locking mechanisms (__metatable field, C-level locking) before applying modifications. Default is false.",
                            "default": false
                        },
                        "identity_spoof": {
                            "type": "integer",
                            "description": "Identity level to use when performing the modification. Higher values elevate execution context on metatable access.",
                            "minimum": 0,
                            "maximum": 10,
                            "default": 8
                        }
                    },
                    "required": [
                        "target_path",
                        "metamethods"
                    ]
                },
            },
            {
                name: "registry_scanner",
                description: "Scans the Lua registry table (LUA_REGISTRYINDEX) for all stored values, including hidden and protected entries that are not normally visible through standard Luau APIs. Identifies internal Roblox entries such as the module cache, shared table storage, identity-to-actor mappings, loaded library handles, and custom userdata references. Returns a structured listing of registry keys with their value types, approximate sizes, and memory addresses. Can filter by key pattern, value type, or expected category to narrow results from the typically thousands of registry entries.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "filter_key": {
                            "type": "string",
                            "description": "Lua pattern (string.match format) to filter registry entries by key. Use '*' as wildcard. Leave empty to return all entries (will be capped by max_results).",
                            "examples": [
                                "module*",
                                "Modules.",
                                "*.shared",
                                "Instance_*"
                            ],
                            "default": "*"
                        },
                        "filter_type": {
                            "type": "string",
                            "description": "Filter registry entries by their value type. 'all' returns every type. 'function' returns only function entries. 'table' returns only table entries. 'userdata' returns only userdata entries. 'thread' returns only thread/coroutine entries.",
                            "enum": [
                                "all",
                                "function",
                                "table",
                                "userdata",
                                "thread",
                                "string",
                                "number"
                            ],
                            "default": "all"
                        },
                        "max_results": {
                            "type": "integer",
                            "description": "Maximum number of registry entries to return. Prevents excessive output on large registries. Set to 0 to return all matching entries (use with caution).",
                            "minimum": 0,
                            "maximum": 10000,
                            "default": 200
                        },
                        "show_values": {
                            "type": "boolean",
                            "description": "When true, includes a preview of each entry's value (first 150 characters for strings/functions, memory address for tables/userdata). Default is false.",
                            "default": false
                        },
                        "include_protected": {
                            "type": "boolean",
                            "description": "When true, attempts to include registry entries that are typically hidden or marked as read-only. May trigger tamper-evident heuristics. Default is false.",
                            "default": false
                        }
                    },
                    "required": []
                },
            },
            {
                name: "debug_info_extractor",
                description: "Extracts comprehensive debug information from any loaded Luau function, including its source name, line numbers, upvalue names and current values, constant table entries, prototype hierarchy, and local variable liveness ranges. Uses Luau's internal debug library at the C level to access information not exposed through the sandboxed debug library. Can trace the function's origin module, its identity level, and whether it was compiled from source or constructed dynamically. Returns structured data suitable for both human inspection and programmatic analysis.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "function_ref": {
                            "type": "string",
                            "description": "Reference to the target function. Accepts a global function name (e.g. 'global.warn'), a path to an Instance method (e.g. 'Instance:Clone'), a function from registry scan (e.g. 'registry.0x7ff2_function_3'), or a Lua expression that evaluates to a function.",
                            "examples": [
                                "global.warn",
                                "Instance:Destroy",
                                "registry.0x7ff2_function_3",
                                "_G.math.sin"
                            ]
                        },
                        "include_source": {
                            "type": "boolean",
                            "description": "When true, returns the function's source code if available. Functions compiled from source generally have this; dynamically created functions may not. Default is true.",
                            "default": true
                        },
                        "include_constants": {
                            "type": "boolean",
                            "description": "When true, dumps all constants referenced by the function including numbers, strings, booleans, and nested proto references. Default is true.",
                            "default": true
                        },
                        "include_upvalues": {
                            "type": "boolean",
                            "description": "When true, lists all upvalue names, their current runtime values, and their stack/closure origins. Default is true.",
                            "default": true
                        },
                        "include_locals": {
                            "type": "boolean",
                            "description": "When true, lists all local variables with their liveness ranges (start/end instruction offsets). Default is false.",
                            "default": false
                        },
                        "max_locals_per_function": {
                            "type": "integer",
                            "description": "Maximum number of local variables to display per function or prototype level. Default is 50.",
                            "minimum": 1,
                            "maximum": 500,
                            "default": 50
                        }
                    },
                    "required": [
                        "function_ref"
                    ]
                },
            },
            
            
            {
                name: "luau_code_executor",
                description: "Executes arbitrary Luau source code in the target Roblox process with full read and write access to the global environment, registry, and DataModel. Supports configurable identity levels to control which API restrictions apply during execution, with higher identities elevating execution context. The executed code runs synchronously by default but can be scheduled asynchronously on a separate Lua thread. All standard Luau libraries are available including debug, io (if accessible), andOS-level calls depending on the identity level. Returns any values returned by the executed code, or an error message if execution fails. You can provide a `url` to fetch and execute code remotely.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "code": {
                            "type": "string",
                            "description": "Luau source code string to execute. Can be a single expression, a statement block, or a full function body. Must be syntactically valid Luau.",
                            "examples": [
                                "return game:GetService(\"Players\").LocalPlayer",
                                "for _,v in pairs(game.Workspace:GetChildren()) do print(v.Name) end"
                            ]
                        },
                        "url": {
                            "type": "string",
                            "description": "Optional URL to fetch and execute Luau code from. Takes precedence over `code` if provided."
                        },
                        "file": {
                            "type": "string",
                            "description": "Optional file path. The MCP server will read the file and execute its contents."
                        },
                        "identity_level": {
                            "type": "integer",
                            "description": "Identity level to execute the code under. Identity 0-2 is standard sandbox. Identity 3-7 has increasing script/module access. Identity 8+ has full API access including HTTP requests and plugin APIs. Default is 8.",
                            "minimum": 0,
                            "maximum": 11,
                            "default": 8
                        },
                        "timeout_ms": {
                            "type": "integer",
                            "description": "Maximum execution time in milliseconds before the code is forcefully terminated. Prevents infinite loops from blocking the game thread. Default is 5000.",
                            "minimum": 100,
                            "maximum": 60000,
                            "default": 5000
                        },
                        "return_mode": {
                            "type": "string",
                            "description": "How to handle return values. 'all' returns all values. 'first' returns only the first value. 'count' returns only the count of return values. 'none' discards return values and returns only success status. Default is 'all'.",
                            "enum": [
                                "all",
                                "first",
                                "count",
                                "none"
                            ],
                            "default": "all"
                        },
                        "async": {
                            "type": "boolean",
                            "description": "When true, executes the code on a separate Lua coroutine and returns immediately with a handle to check execution status later. Default is false.",
                            "default": false
                        },
                        "environment_overrides": {
                            "type": "string",
                            "description": "Optional JSON string of key-value pairs to merge into global _G. Example: '{\"myVar\":\"injected string\",\"myFunc\":\"function(...) return ... end\"}'. Empty/null = no overrides."
                        }
                    },
                    "anyOf": [
                        { "required": ["code"] },
                        { "required": ["url"] },
                        { "required": ["file"] }
                    ]
                },
            },
            
            {
                name: "closure_inspector",
                description: "Dumps the complete internal structure of any Luau closure including its prototype tree, constants table, upvalue descriptors, debug name, line number mapping, and nested inner closures. Provides a full structural breakdown useful for understanding obfuscated or minified code without executing it. Can recursively traverse nested prototype hierarchies to reveal the complete closure tree. Reports the identity level associated with the closure, its source chunk name, and its compiled bytecode size. The output is structured as a hierarchical JSON document representing the closure's full prototype graph.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "function_ref": {
                            "type": "string",
                            "description": "Reference to the function or closure to inspect. Accepts global names, Instance methods, registry references, or Lua expressions that evaluate to a function.",
                            "examples": [
                                "game:GetService",
                                "global.warn",
                                "registry.0x7ff2_func_7",
                                "_G.table.insert"
                            ]
                        },
                        "max_depth": {
                            "type": "integer",
                            "description": "Maximum depth to recurse into nested prototype trees (inner closures). A depth of 1 inspects only the top-level function. Higher values reveal nested function definitions. Default is 3, max is 20.",
                            "minimum": 1,
                            "maximum": 20,
                            "default": 3
                        },
                        "max_constants": {
                            "type": "integer",
                            "description": "Maximum number of constant entries to display per prototype level. Prevents excessively large output from modules with huge constant tables. Default is 100.",
                            "minimum": 1,
                            "maximum": 5000,
                            "default": 100
                        },
                        "max_upvalues": {
                            "type": "integer",
                            "description": "Maximum number of upvalue entries to display per prototype level. Default is 50.",
                            "minimum": 1,
                            "maximum": 500,
                            "default": 50
                        },
                        "show_instructions": {
                            "type": "boolean",
                            "description": "When true, includes a disassembly listing of each prototype's bytecode instructions. Default is false.",
                            "default": false
                        },
                        "include_raw_addresses": {
                            "type": "boolean",
                            "description": "When true, includes raw memory addresses of the closure, proto, and constant objects for low-level debugging. Default is false.",
                            "default": false
                        }
                    },
                    "required": [
                        "function_ref"
                    ]
                },
            },
            {
                name: "sandbox_analyzer",
                description: "Analyzes the current Luau execution environment for sandbox restrictions, identity level, and security protections. Tests which APIs and globals are accessible, identifies which functions have been hooked or proxied, detects metatable locks, and checks for common tamper-evident measures such as __namecall filtering, function identity checks, and bytecode integrity verification. Produces a comprehensive sandbox profile including the current identity level, a list of blocked or restricted globals/API methods, detected hooks in core library functions, accessible debug capabilities, and recommended execution expansion vectors. Returns structured data suitable for planning further testing steps.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "test_globals": {
                            "type": "boolean",
                            "description": "When true, enumerates all global environment entries and tests which ones are accessible, wrapped, or proxied from the current context. Default is true.",
                            "default": true
                        },
                        "test_apis": {
                            "type": "array",
                            "description": "Optional list of specific Roblox API methods or services to test for accessibility. Each entry is tested for callability and any argument restrictions. Leave empty to test common targets automatically.",
                            "items": {
                                "type": "string",
                                "examples": [
                                    "game:GetService",
                                    "Instance:new",
                                    "HttpService:PostAsync",
                                    "debug.getregistry",
                                    "loadstring"
                                ]
                            }
                        },
                        "test_depth": {
                            "type": "string",
                            "description": "How thoroughly to probe the sandbox. 'quick' tests a standard set of 30 indicators. 'standard' runs comprehensive checks including metatable inspection and function hook detection. 'paranoid' also attempts known bypass techniques to map the full validation surface. Default is 'standard'.",
                            "enum": [
                                "quick",
                                "standard",
                                "paranoid"
                            ],
                            "default": "standard"
                        },
                        "detect_hooks": {
                            "type": "boolean",
                            "description": "When true, compares checksums of in-memory core library functions against their expected bytecode to detect existing function hooks (installed by security systems or other security testing tools). Default is true.",
                            "default": true
                        },
                        "identity_probe": {
                            "type": "boolean",
                            "description": "When true, attempts to determine the current script's identity level through multiple heuristics including API accessibility tests and C-level queries. Default is true.",
                            "default": true
                        }
                    },
                    "required": []
                },
            },
            {
                name: "get_loaded_modules",
                description: "List every ModuleScript currently loaded in the Lua registry. When include_source is true, attempts to read the compiled source (decompiled if the executor supports it). Critical for reverse-engineering the game internal logic.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "include_source": {
                            "type": "boolean",
                            "description": "Attempt to read decompiled source",
                            "default": true
                        },
                        "filter_by_name": {
                            "type": "string",
                            "description": "Filter modules by name substring"
                        },
                        "max_modules": {
                            "type": "number",
                            "description": "Maximum modules to return",
                            "default": 50
                        }
                    },
                    "required": []
                },
            },
            {
                name: "dump_constants_and_upvalues",
                description: "Inspect a loaded function or module for its constants (strings, numbers) and upvalues (closed-over variables). Invaluable for reverse-engineering encrypted or obfuscated game logic without reading the full source.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "target_path": {
                            "type": "string",
                            "description": "Full game path or module path to inspect"
                        },
                        "include_prototypes": {
                            "type": "boolean",
                            "description": "Include nested function prototypes",
                            "default": false
                        },
                        "max_depth": {
                            "type": "number",
                            "description": "Maximum recursion depth for nested inspection",
                            "default": 3
                        }
                    },
                    "required": [
                        "target_path"
                    ]
                },
            },
            {
                name: "check_unc_capabilities",
                description: "Test which UNC functions are available in the executor and return the capability report. Useful for debugging why certain tools fail — the executor may not support all required UNC functions.",
                inputSchema: {
                    "type": "object",
                    "properties": { "json_data": { "type": "string", "description": "JSON stringified object data" } },
                    "required": []
                }
            },





            {
                name: "remote_event_trigger",
                description: "Fires a RemoteEvent from the client to the server using the FireServer/InvokeServer equivalent mechanism. Accepts the target remote's full path or Instance and a variable-length list of arguments to pass. Supports passing primitive types, strings, tables, CFrames, Vector3, Color3, Ray, EnumItems, and nested data structures. Automatically coerces Lua-safe values. This is the core execution primitive for triggering server-side logic from the client.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "remote_path": {
                            "type": "string",
                            "description": "Full hierarchical path to the RemoteEvent instance, e.g. 'game.ReplicatedStorage.MyRemote'. Must point to an existing RemoteEvent."
                        },
                        "arguments": {
                            "type": "string",
                            "description": "JSON string of arguments to pass to FireServer (e.g. '[\"hello\", 42, true, {\"__type\":\"Vector3\",\"x\":1,\"y\":2,\"z\":3}]'). Empty string or null = no arguments."
                        },
                        "timeout": {
                            "type": "number",
                            "description": "Maximum time in seconds to wait for the server to acknowledge receipt before considering the send failed. Default is 5. Minimum is 0.5, maximum is 30.",
                            "default": 5,
                            "minimum": 0.5,
                            "maximum": 30
                        }
                    },
                    "required": [
                        "remote_path"
                    ],
                    "additionalProperties": false
                },
            },
            {
                name: "remote_connection_inspector",
                description: "Inspects all active connections, handlers, and listeners attached to a specific RemoteEvent or RemoteFunction instance. Returns the count of connected handlers, each handler's associated Lua function signature (if readable), the owning script path, and whether the connection is currently connected. This is essential for understanding what server-side or client-side logic will execute when a remote is triggered, enabling precise targeting of reverse-engineering efforts.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "remote_path": {
                            "type": "string",
                            "description": "Full hierarchical path to the RemoteEvent or RemoteFunction instance to inspect, e.g. 'game.ReplicatedStorage.TradeRemote'."
                        },
                        "include_handler_source": {
                            "type": "boolean",
                            "description": "Whether to attempt to retrieve the source code location (script path and line number) of each connected handler. Default is true.",
                            "default": true
                        },
                        "include_function_prototype": {
                            "type": "boolean",
                            "description": "Whether to include a partial decompilation or debug info of the handler function signature (parameter count, upvalues). Default is false.",
                            "default": false
                        }
                    },
                    "required": [
                        "remote_path"
                    ],
                    "additionalProperties": false
                },
            },
            
            {
                name: "traffic_interceptor_installer",
                description: "Injects a hook into the metatable of RemoteEvent.FireServer and RemoteFunction.InvokeServer to intercept ALL outgoing remote traffic. Every call to FireServer or InvokeServer is logged with the remote path, serialized arguments, timestamp, and a unique call ID. The hook can optionally pause execution (block the call) or modify arguments before forwarding. Returns a session ID that must be used to manage or remove the hook later. This is the central surveillance tool for reverse-engineering network protocols.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "capture_callstack": {
                            "type": "boolean",
                            "description": "Whether to capture the Lua call stack (debug.traceback) at each intercepted call site to identify what script or UI action triggered the remote call. Default is true.",
                            "default": true
                        },
                        "capture_full_arguments": {
                            "type": "boolean",
                            "description": "Whether to deep-copy the full argument table at interception time. When false, captures only argument type signatures. Default is true.",
                            "default": true
                        },
                        "paused_by_default": {
                            "type": "boolean",
                            "description": "If true, all remote calls are paused (blocked from reaching the server) until explicitly resumed via traffic_filter_setter or per-remote unblocking. Default is false.",
                            "default": false
                        },
                        "max_captured_calls": {
                            "type": "integer",
                            "description": "Maximum number of intercepted calls to buffer in memory before oldest entries are evicted. Default is 5000. Minimum is 100, maximum is 100000.",
                            "default": 5000,
                            "minimum": 100,
                            "maximum": 100000
                        }
                    },
                    "required": [],
                    "additionalProperties": false
                },
            },
            
            {
                name: "remote_blocker_installer",
                description: "Blocks one or more specific RemoteEvent or RemoteFunction instances from sending data to the server by short-circuiting their FireServer/InvokeServer calls. When blocked, the call returns immediately without error but no network packet is dispatched. Unblocked remotes continue functioning normally. This is used to selectively disable specific game features (anticheat checks, telemetry, analytics) without affecting other network functionality.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "remote_paths": {
                            "type": "array",
                            "description": "Array of full hierarchical paths to the RemoteEvent or RemoteFunction instances to block. Each must be a valid remote instance path.",
                            "items": {
                                "type": "string",
                                "description": "Full path to a remote instance, e.g. 'game.ReplicatedStorage.AnticheatPing'."
                            },
                            "minItems": 1
                        },
                        "behavior": {
                            "type": "string",
                            "description": "Blocking behavior: 'silent' returns nil without error, 'error' throws a fake network error, 'stall' hangs the call indefinitely. Default is 'silent'.",
                            "default": "silent",
                            "enum": [
                                "silent",
                                "error",
                                "stall"
                            ]
                        },
                        "apply_to_incoming": {
                            "type": "boolean",
                            "description": "Whether to also block incoming server responses for RemoteFunction calls on blocked remotes. Default is false.",
                            "default": false
                        }
                    },
                    "required": [
                        "remote_paths"
                    ],
                    "additionalProperties": false
                },
            },
            {
                name: "remote_killswitch_toggler",
                description: "A global killswitch that blocks ALL RemoteEvent.FireServer and RemoteFunction.InvokeServer calls across the entire client session. When enabled, no client-to-server network traffic is sent regardless of which remote is called or what script triggers it. When disabled, normal traffic flow resumes. This is the emergency override for testing, preventing telemetry leaks, or isolating network behavior. Returns the new state of the killswitch.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "enabled": {
                            "type": "boolean",
                            "description": "True to activate the killswitch and block ALL outgoing remote traffic. False to deactivate and restore normal network functionality."
                        },
                        "whitelist_paths": {
                            "type": "array",
                            "description": "Optional array of remote paths that should be exempt from the killswitch and allowed to pass through normally. Useful for keeping essential functionality alive.",
                            "items": {
                                "type": "string",
                                "description": "Full path to a remote instance to whitelist, e.g. 'game.ReplicatedStorage.EssentialPing'."
                            },
                            "default": []
                        },
                        "acknowledge_consequences": {
                            "type": "boolean",
                            "description": "Must be set to true as a safety confirmation acknowledging that enabling this will break all server communication.",
                            "default": false
                        }
                    },
                    "required": [
                        "enabled"
                    ],
                    "additionalProperties": false
                },
            },
            {
                name: "argument_spoofer",
                description: "Installs a packet modification middleware that intercepts outgoing arguments for specified remotes and applies user-defined transformations before the data reaches the server. Supports transforming individual arguments by index, replacing entire argument tables, applying Lua functions, or injecting/deleting arguments. Transformations can be static (always replace with fixed values) or dynamic (based on context such as call count or time). This is the primary tool for testing game state validation by sending manipulated state to the server.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "remote_paths": {
                            "type": "array",
                            "description": "Array of full remote paths whose arguments should be transformed. Use '*' to apply to all remotes.",
                            "items": {
                                "type": "string",
                                "description": "Full path to a remote instance or '*' for all remotes."
                            },
                            "minItems": 1
                        },
                        "transformations": {
                            "type": "array",
                            "description": "Array of transformation rules specifying which arguments to modify and their replacement values. Each rule targets a specific argument index or a pattern.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "argument_index": {
                                        "type": "integer",
                                        "description": "0-based index of the argument to transform. Use -1 to target all arguments.",
                                        "minimum": -1
                                    },
                                    "mode": {
                                        "type": "string",
                                        "description": "Transformation mode: 'replace' replaces the argument with fixed_value; 'inject' inserts a new argument at the specified index; 'delete' removes the argument; 'mutate' applies a Lua expression string from 'expression' field.",
                                        "enum": [
                                            "replace",
                                            "inject",
                                            "delete",
                                            "mutate"
                                        ]
                                    },
                                    "fixed_value": {
                                        "type": "object", "description": "The replacement value to use when mode is 'replace' or 'inject'.", "properties": { "json_data": { "type": "string", "description": "JSON stringified object data" } }
                                    },
                                    "expression": {
                                        "type": "string",
                                        "description": "A Lua expression string to evaluate for the new argument value when mode is 'mutate'. The variables 'arg', 'index', 'remote', and 'call_count' are available in scope."
                                    },
                                    "condition": {
                                        "type": "string",
                                        "description": "Optional Lua expression that must evaluate to true for this transformation to apply. The variable 'call_count' is available. E.g., 'call_count % 5 == 0' to spoof every 5th call."
                                    }
                                },
                                "required": [
                                    "argument_index",
                                    "mode"
                                ],
                                "additionalProperties": false
                            },
                            "minItems": 1
                        },
                        "passthrough_unmatched": {
                            "type": "boolean",
                            "description": "If true, arguments not matching any transformation rule are passed through to the server unchanged. If false, unmatched arguments are dropped. Default is true.",
                            "default": true
                        }
                    },
                    "required": [
                        "remote_paths",
                        "transformations"
                    ],
                    "additionalProperties": false
                },
            },
            
            {
                name: "traffic_filter_setter",
                description: "Configures a global or per-remote filter that controls which remote calls are monitored, logged, or visible in the interception buffer. This tool works in conjunction with the traffic_interceptor_installer to reduce noise from high-frequency remotes (e.g., character movement, physics heartbeats) and focus on specific remotes of interest. Supports include lists (only these remotes), exclude lists (skip these remotes), and pattern-based matching using wildcards. Filter changes take effect immediately for all subsequent intercepted calls.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "session_id": {
                            "type": "string",
                            "description": "The interception session ID to apply this filter to. If omitted, applies to the filter for the currently active interception session."
                        },
                        "include_patterns": {
                            "type": "array",
                            "description": "Array of glob/wildcard patterns for remote paths to INCLUDE in monitoring. Only remotes matching any of these patterns will be captured. Empty or omitted means include all. Example: ['*.RemoteEvent', 'game.ReplicatedStorage.Trade*']",
                            "items": {
                                "type": "string",
                                "description": "A glob pattern matching remote paths."
                            },
                            "default": []
                        },
                        "exclude_patterns": {
                            "type": "array",
                            "description": "Array of glob/wildcard patterns for remote paths to EXCLUDE from monitoring. Remotes matching any exclude pattern are silently ignored. This runs after include pattern matching. Example: ['*Heartbeat*', '*Physics*']",
                            "items": {
                                "type": "string",
                                "description": "A glob pattern matching remote paths to exclude."
                            },
                            "default": []
                        },
                        "log_to_console": {
                            "type": "boolean",
                            "description": "Whether to also print intercepted calls matching this filter to the developer console. Default is false.",
                            "default": false
                        },
                        "max_call_rate": {
                            "type": "integer",
                            "description": "Maximum number of intercepted calls per second to log from matching remotes. Calls exceeding this rate are counted but not individually recorded. Use 0 for unlimited. Default is 100.",
                            "default": 100,
                            "minimum": 0,
                            "maximum": 10000
                        }
                    },
                    "required": [],
                    "additionalProperties": false
                },
            },
            
            {
                name: "replication_filter_checker",
                description: "Queries and analyzes the server's ReplicationFilter data to understand what objects, properties, and instances the server is replicating to the client. The ReplicationFilter controls which game data is sent over the network from server to client. Analyzing it reveals what the server intentionally hides (e.g., map boundaries, hidden NPC positions, secret doors) and what it deems irrelevant. Returns a structured breakdown of filtered classes, properties, and exclusions currently active in the replication stream.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "include_class_filters": {
                            "type": "boolean",
                            "description": "Whether to include the per-class replication filter data showing which Roblox classes have modified replication settings. Default is true.",
                            "default": true
                        },
                        "include_property_filters": {
                            "type": "boolean",
                            "description": "Whether to include per-property replication filter data showing which specific properties are blocked from replication. Default is true.",
                            "default": true
                        },
                        "include_instance_exceptions": {
                            "type": "boolean",
                            "description": "Whether to include instance-level replication exceptions showing specific objects that bypass or are excluded from general class filters. Default is false.",
                            "default": false
                        },
                        "container_filter": {
                            "type": "string",
                            "description": "Optional container to scope the replication filter analysis to, e.g. 'game.Workspace' or 'game.ReplicatedStorage'. If omitted, returns the global replication filter state."
                        }
                    },
                    "required": [],
                    "additionalProperties": false
                },
            },
            {
                name: "spy_remote_traffic",
                description: "Master tool for network traffic interception, blocking, and argument spoofing. Hooks FireServer/InvokeServer on RemoteEvent/RemoteFunction instances via __namecall metatable hook.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": [
                                "install",
                                "get_log",
                                "clear",
                                "block",
                                "unblock",
                                "ignore",
                                "unignore",
                                "remove"
                            ],
                            "description": "Action: 'install' hooks traffic, 'get_log' returns captured data, 'block' stops remotes, 'ignore' skips logging for remotes, 'remove' unhooks."
                        },
                        "filter_remote_path": {
                            "type": "string",
                            "description": "Only intercept calls for remotes whose Name matches this substring (applies to install/spy actions)"
                        },
                        "max_log_entries": {
                            "type": "number",
                            "description": "Maximum log entries to retain during spying (default: 500)"
                        },
                        "max_results": {
                            "type": "number",
                            "description": "Maximum log entries to return for 'get_log' action (default: 500)"
                        },
                        "include_bindables": {
                            "type": "boolean",
                            "description": "Include BindableEvent/BindableFunction in spy (default: false)"
                        },
                        "remote_paths": {
                            "type": "array",
                            "description": "Array of full hierarchical remote paths to block or unblock. Used with 'block'/'unblock'/'release' actions.",
                            "items": {
                                "type": "string"
                            }
                        },
                        "spoof_remote": {
                            "type": "string",
                            "description": "Full path to the remote whose arguments should be spoofed. Used with 'spoof' action."
                        },
                        "spoof_arguments": {
                            "type": "array",
                            "description": "Replacement arguments to send instead of the original ones. Used with 'spoof' action.",
                            "items": { "type": "string" }
                        },
                        "block_remotes": {
                            "type": "array",
                            "description": "Alias for remote_paths. Array of remote paths to block/unblock.",
                            "items": {
                                "type": "string"
                            }
                        }
                    },
                    "required": [
                        "action"
                    ]
                },
            },
            {
                name: "get_network_ownership",
                description: "Analyze network ownership of BasePart instances in Workspace. Returns which parts the client owns (can physics-lag exploit), which are server-owned, and which are unowned. Useful for physics authority testing.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "filter_by_name": {
                            "type": "string",
                            "description": "Filter parts by name substring"
                        },
                        "include_assembly_info": {
                            "type": "boolean",
                            "description": "Include assembly mass and center of mass data",
                            "default": false
                        },
                        "max_parts": {
                            "type": "number",
                            "description": "Maximum parts to analyze",
                            "default": 100
                        }
                    },
                    "required": []
                },
            },
            {
                name: "teleport_to_target",
                description: "Instant CFrame teleportation. Supports teleporting to absolute coordinates, a named player position, a specific workspace instance by name, or the current mouse/target position. Uses CFrame manipulation so it avoids basic coordinate validation.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "target_type": {
                            "type": "string",
                            "enum": [
                                "coordinates",
                                "player",
                                "instance",
                                "mouse"
                            ],
                            "description": "Type of teleport target"
                        },
                        "coordinates": {
                            "type": "object",
                            "properties": {
                                "x": {
                                    "type": "number"
                                },
                                "y": {
                                    "type": "number"
                                },
                                "z": {
                                    "type": "number"
                                }
                            },
                            "description": "Absolute coordinates for coordinate-based teleport"
                        },
                        "target_name": {
                            "type": "string",
                            "description": "Name of target player or workspace instance"
                        },
                        "offset": {
                            "type": "object",
                            "properties": {
                                "x": {
                                    "type": "number"
                                },
                                "y": {
                                    "type": "number"
                                },
                                "z": {
                                    "type": "number"
                                }
                            },
                            "description": "Position offset from target",
                            "default": {
                                "y": 3
                            }
                        }
                    },
                    "required": [
                        "target_type"
                    ]
                },
            },
            {
                name: "interact_all_proximity_prompts",
                description: "Trigger every ProximityPrompt within range instantly, ignoring HoldDuration and Cooldown. Useful for auto-farming interactions (pickups, doors, NPCs) or testing prompt-based mechanics.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "range": {
                            "type": "number",
                            "description": "Maximum range to scan for prompts",
                            "default": 50
                        },
                        "max_prompts": {
                            "type": "number",
                            "description": "Maximum prompts to trigger (0 = unlimited)",
                            "default": 0
                        },
                        "include_requires_director": {
                            "type": "boolean",
                            "description": "Include prompts that require a director (VR)",
                            "default": false
                        }
                    },
                    "required": []
                },
            },





            {
                name: "gui_button_clicker",
                description: "Fires click signals on a GUI button using UNC firesignal. Sends Activated, MouseButton1Down, MouseButton2Down, MouseButton1Click, and MouseButton2Click signals. Requires firesignal UNC support.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Full path to the GuiButton instance." }
                    },
                    "required": ["path"]
                }
            },
            {
                name: "script_decompiler",
                description: "Decompiles a Script, ModuleScript, or LocalScript using the decompile chain (LuaExpert to Medal to Konstant). Falls back through multiple decompile services.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "target_path": { "type": "string", "description": "Full path to the script instance." }
                    },
                    "required": ["target_path"]
                }
            },
            {
                name: "fire_click_detector",
                description: "Fires a ClickDetector on the target instance using UNC fireclickdetector. Useful for interacting with clickable objects without physically clicking them.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "target_path": { "type": "string", "description": "Path to instance containing a ClickDetector child." }
                    },
                    "required": ["target_path"]
                }
            },
            {
                name: "fire_proximity_prompt",
                description: "Fires a ProximityPrompt on the target instance using UNC fireproximityprompt. Triggers it instantly, ignoring HoldDuration and range checks.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "target_path": { "type": "string", "description": "Path to instance containing a ProximityPrompt child." }
                    },
                    "required": ["target_path"]
                }
            },
            {
                name: "hidden_property_reader",
                description: "Reads a hidden non-scriptable property from an instance using UNC gethiddenproperty. Accesses properties normally hidden from Lua scripts.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "instance_path": { "type": "string", "description": "Full path to the target instance." },
                        "property": { "type": "string", "description": "Name of the hidden property to read." }
                    },
                    "required": ["instance_path", "property"]
                }
            },
            {
                name: "hidden_property_writer",
                description: "Writes a value to a hidden non-scriptable property on an instance using UNC sethiddenproperty.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "instance_path": { "type": "string", "description": "Full path to the target instance." },
                        "property": { "type": "string", "description": "Name of the hidden property to write." },
                        "value": { "description": "Value to set on the hidden property." }
                    },
                    "required": ["instance_path", "property", "value"]
                }
            },
            {
                name: "property_scriptable_toggler",
                description: "Makes a non-scriptable property readable and writable from Lua using UNC setscriptable.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "instance_path": { "type": "string", "description": "Full path to the target instance." },
                        "property": { "type": "string", "description": "Name of the property to make scriptable." }
                    },
                    "required": ["instance_path", "property"]
                }
            },





            
            {
                name: "closure_type_checker",
                description: "Checks the type of a Lua closure using UNC iscclosure, islclosure, and isexecutorclosure. Returns whether a function is a C closure (engine), Lua closure (script), or executor closure (injected). Also reports checkcaller status to determine if the current code is executing in the executor's context.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "function_path": { "type": "string", "description": "Path or Lua expression evaluating to the function to inspect." },
                        "name": { "type": "string", "description": "Optional name for the function for display purposes." }
                    },
                    "required": ["function_path"]
                }
            },





            {
                name: "gc_scanner",
                description: "Scans the Lua garbage collector table using UNC getgc. Returns all objects in the GC filtered by type (function, table, thread, userdata). Can search for specific function names or table patterns. Use this to find hidden functions, detect anomalies, or discover undocumented APIs.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "filter_type": { "type": "string", "enum": ["all", "function", "table", "thread"], "default": "all", "description": "Type of GC objects to return." },
                        "name_pattern": { "type": "string", "description": "Substring to match against function names or table keys." },
                        "max_results": { "type": "number", "default": 50, "description": "Maximum objects to return." }
                    }
                }
            },
            
            {
                name: "roblox_environment_viewer",
                description: "Reads values from the global Roblox environment (getrenv) and the executor environment (getgenv). Compares the two to find injected functions, overridden globals, or security wrappers. Returns a diff of custom globals added by the executor.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "namespace": { "type": "string", "enum": ["renv", "genv", "both"], "default": "both", "description": "Which environment(s) to inspect." },
                        "filter_pattern": { "type": "string", "description": "Optional filter for global names." }
                    }
                }
            },
            {
                name: "script_environment_dumper",
                description: "Dumps a script's local environment using UNC getsenv. For a given Script or ModuleScript, returns all local variables, functions, and values defined in its scope. Useful for reverse engineering what data a script holds at runtime.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "script_path": { "type": "string", "description": "Full path to the Script or ModuleScript instance." },
                        "max_values": { "type": "number", "default": 50, "description": "Maximum environment values to return." }
                    },
                    "required": ["script_path"]
                }
            },





            {
                name: "file_reader",
                description: "Reads a file from the executor's filesystem using UNC readfile. The base path is the executor's working directory. Returns the file contents as a string. Supports text files and base64-encoded binary data.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Relative file path within the executor's filesystem." }
                    },
                    "required": ["path"]
                }
            },
            {
                name: "file_writer",
                description: "Writes content to a file in the executor's filesystem using UNC writefile. Creates the file if it does not exist, overwrites if it does. The base path is the executor's working directory.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Relative file path to write to." },
                        "content": { "type": "string", "description": "Text content to write to the file." }
                    },
                    "required": ["path", "content"]
                }
            },
            {
                name: "file_deleter",
                description: "Deletes a file from the executor's filesystem using UNC delfile. Also supports recursive folder deletion via delfolder. Confirms the file existed before deletion.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Relative file or folder path." },
                        "recursive": { "type": "boolean", "default": false, "description": "If true and path is a folder, deletes recursively." }
                    },
                    "required": ["path"]
                }
            },
            {
                name: "file_lister",
                description: "Lists files and folders in a directory using UNC listfiles. Returns all entries in the specified directory with their names, sizes, and whether they are files or folders.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "default": "", "description": "Directory path to list. Empty lists the executor's root." },
                        "include_details": { "type": "boolean", "default": true, "description": "Include file size and last modified time." }
                    }
                }
            },
            {
                name: "folder_creator",
                description: "Creates a folder in the executor's filesystem using UNC makefolder. Creates parent directories if they do not exist. Returns success status.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Folder path to create." }
                    },
                    "required": ["path"]
                }
            },
            {
                name: "custom_asset_loader",
                description: "Loads a file as a Roblox custom asset using UNC getcustomasset. Returns a rbxasset:// URL that can be used anywhere Roblox accepts asset IDs. Useful for loading custom images, sounds, or meshes from the executor's filesystem.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "file_path": { "type": "string", "description": "Path to the file in the executor's filesystem." },
                        "asset_type": { "type": "string", "enum": ["auto", "image", "sound", "mesh"], "default": "auto", "description": "Type of asset being loaded." }
                    },
                    "required": ["file_path"]
                }
            },





            {
                name: "running_scripts_lister",
                description: "Lists all currently running Lua scripts in the game using UNC getrunningscripts. Returns each script's name, class, path, thread ID, and execution status. Different from get_loaded_modules which returns ModuleScripts — this returns actively executing scripts.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "filter_by_class": { "type": "string", "description": "Filter by class name: Script, LocalScript, ModuleScript." },
                        "include_source": { "type": "boolean", "default": false, "description": "Attempt to read the script source." },
                        "max_scripts": { "type": "number", "default": 100, "description": "Maximum scripts to return." }
                    }
                }
            },
            {
                name: "calling_script_finder",
                description: "Returns the script that called the current execution context using UNC getcallingscript. Useful for understanding the call stack, detecting which script triggered an action, or tracing execution flow.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "stack_level": { "type": "number", "default": 0, "description": "Stack frame level to check. 0 = immediate caller, 1 = caller's caller, etc." }
                    }
                }
            },
            {
                name: "script_closure_getter",
                description: "Gets the main closure/function of a script using UNC getscriptclosure. Returns a reference to the script's main function that can be inspected with other debug tools. Also returns debug info about the closure.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "script_path": { "type": "string", "description": "Full path to the script instance." },
                        "include_debug_info": { "type": "boolean", "default": true, "description": "Include upvalue count and constants from the closure." }
                    },
                    "required": ["script_path"]
                }
            },
            {
                name: "script_hash_calculator",
                description: "Computes the hash of a script's bytecode or source using UNC getscripthash. Useful for identifying scripts across sessions, detecting script modifications, or verifying script integrity.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "script_path": { "type": "string", "description": "Full path to the script instance." }
                    },
                    "required": ["script_path"]
                }
            },





            {
                name: "raw_metatable_setter",
                description: "Sets a raw metatable on a table or instance using UNC setrawmetatable, bypassing the __metatable field. Can wrap objects with custom __index, __newindex, __call, and other metamethods for interception and monitoring.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "target_path": { "type": "string", "description": "Path to the target instance or table." },
                        "metatable_code": { "type": "string", "description": "Luau code returning a metatable table (e.g. '{ __index = function(self, k) return rawget(self, k) end }')." }
                    },
                    "required": ["target_path", "metatable_code"]
                }
            },
            {
                name: "readonly_toggler",
                description: "Toggles the readonly state of a table using UNC setreadonly/isreadonly. Can make read-only tables writable or lock tables from further modification. Returns the previous readonly state.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "target_path": { "type": "string", "description": "Path or Lua expression resolving to the table." },
                        "state": { "type": "boolean", "description": "true = make readonly, false = make writable." }
                    },
                    "required": ["target_path", "state"]
                }
            },




            {
                name: "instance_comparer",
                description: "Compares two Roblox instances for equality using UNC compareinstances. Handles cases where instances may have been cloned or have different references to the same object. Returns whether they refer to the same underlying instance.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "path_a": { "type": "string", "description": "First instance path." },
                        "path_b": { "type": "string", "description": "Second instance path." },
                        "compare_mode": { "type": "string", "enum": ["reference", "name", "path"], "default": "reference", "description": "Comparison mode." }
                    },
                    "required": ["path_a", "path_b"]
                }
            },
            {
                name: "signal_replicator",
                description: "Replicates a signal/event across the Roblox network using UNC replicatesignal. Can trigger remote events as if they came from the server. Use with caution — this can simulate server responses on the client.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "remote_path": { "type": "string", "description": "Full path to the RemoteEvent or BindableEvent." },
                        "args": { "type": "array", "description": "Arguments to replicate with the signal.", "items": { "type": "string" } },
                        "fire_all": { "type": "boolean", "default": true, "description": "If true, fires all connections; if false, fires only the first." }
                    },
                    "required": ["remote_path"]
                }
            },





            {
                name: "get_roblox_processes",
                description: "List all running RobloxPlayerBeta processes on this machine. Returns PID, process name, window title, and memory usage for each detected process. Use the PID with other tools to target a specific Roblox instance. Also returns the number of active executor sessions currently connected to this server.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "include_all_users": {
                            "type": "boolean",
                            "description": "Include Roblox processes from other user sessions.",
                            "default": false
                        }
                    },
                    "required": []
                }
            },
            {
                name: "launch_roblox",
                description: "Launch the Roblox client application. If a custom path to RobloxPlayerLauncher.exe is provided, uses that; otherwise auto-discovers the installation from Windows Registry or common install paths. Returns the PID of the launched process and the path used. Errors with 'Roblox not found' if not installed.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Custom path to RobloxPlayerLauncher.exe. Leave empty for auto-find."
                        }
                    },
                    "required": []
                }
            },
            {
                name: "open_game",
                description: "Open a Roblox game via roblox-player protocol. Requires a PlaceId. Supports joining via job ID, private server link code, or standard join URL. Constructs full launch URL with auth, tracker, locale params.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "place_id": {
                            "type": "number",
                            "description": "Place ID of the game to open."
                        },
                        "job_id": { "type": "string", "description": "Optional server job ID to join a specific server." },
                        "private_server_link_code": { "type": "string", "description": "Optional private server link code." },
                        "launch_mode": { "type": "string", "enum": ["play", "edit"], "default": "play" },
                        "auth_ticket": { "type": "string", "description": "Optional auth ticket for gameinfo." },
                        "browser_tracker_id": { "type": "string", "description": "Optional browser tracker ID. Auto-generated if empty." },
                        "launch_time": { "type": "string", "description": "Optional launch timestamp. Auto-generated if empty." },
                        "experience_id": { "type": "string", "description": "Optional experience/instance ID." }
                    },
                    "required": ["place_id"]
                }
            },
            {
                name: "capture_roblox_screenshot",
                description: "Capture a screenshot of a Roblox process window on Windows. Uses PowerShell with Win32 PrintWindow by PID. If no PID provided, captures the first RobloxPlayerBeta process. Returns base64-encoded PNG data URL.",
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "pid": { "type": "number", "description": "PID of the Roblox process to capture. Omit for first found." }
                    },
                    "required": []
                }
            },
            
            {
                name: "get_roblox_versions",
                description: "List installed Roblox versions on this machine. Scans Versions directory in Program Files and LocalAppData. Returns version string, whether launcher and player exes exist.",
                inputSchema: {
                    "type": "object",
                    "properties": { "json_data": { "type": "string", "description": "JSON stringified object data" } },
                    "required": []
                }
            },
        ];
    }

    getTools(): ToolDefinition[] {
        return this.tools;
    }

    getTool(name: string): ToolDefinition | undefined {
        return this.tools.find(t => t.name === name);
    }

    get count(): number {
        return this.tools.length;
    }
}

module.exports = { ToolDefinitions };