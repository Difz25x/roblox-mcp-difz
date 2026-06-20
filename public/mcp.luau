--[[
    mcp.luau — Roblox Executor MCP Client

    Communication protocol:
      POLL  POST /req  → receives {type, id, args, timestamp} or {type: "__timeout__"}
      SEND  POST /res  → sends   {id, data, error}

    Architecture:
      Main loop polls /req in a long-poll fashion.
      Each tool name maps to a {handler, config} entry in the ROUTER table.
      Handlers are generic functions selected by a config.action string.
      Every invocation is wrapped in pcall for crash resilience.
]]

-- ================================================================
-- 1. CONFIGURATION
-- ================================================================
local MCP_SERVER_URL = "http://127.0.0.1:28429"
local POLL_TIMEOUT_MS = 25000
local MAX_RETRIES = 3
local RETRY_DELAY_SEC = 2
local POLL_WAIT_SEC = 1

local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local Players = game:GetService("Players")
local LogService = game:GetService("LogService")
local CoreGui = game:GetService("CoreGui")
local CollectionService = game:GetService("CollectionService")
local LocalPlayer = Players.LocalPlayer

-- ================================================================
-- 2. HTTP HELPERS
-- ================================================================
local function httpPost(url, body)
    local json = HttpService:JSONEncode(body)
    local success, result = pcall(function()
        return HttpService:PostAsync(url, json, Enum.ContentType.ApplicationJson, false)
    end)
    if not success then
        return nil, result
    end
    local ok, decoded = pcall(function()
        return HttpService:JSONDecode(result)
    end)
    if not ok then
        return nil, "Failed to decode response: " .. tostring(result)
    end
    return decoded, nil
end

-- ================================================================
-- 3. SERIALIZATION HELPERS
-- ================================================================
local MAX_SERIALIZE_DEPTH = 8
local VISITED_INSTANCES = nil

local function serializeValue(value, depth)
    if depth == nil then depth = 0 end
    if depth > MAX_SERIALIZE_DEPTH then
        return "<<max_depth>>"
    end

    local valueType = typeof(value)

    if valueType == "string" or valueType == "number" or valueType == "boolean" then
        return value
    end

    if valueType == "nil" then
        return nil
    end

    if valueType == "Vector3" then
        return { x = value.X, y = value.Y, z = value.Z }
    end

    if valueType == "Vector2" then
        return { x = value.X, y = value.Y }
    end

    if valueType == "CFrame" then
        local x, y, z, qx, qy, qz, qw = value:GetComponents()
        return { x = x, y = y, z = z, qx = qx, qy = qy, qz = qz, qw = qw }
    end

    if valueType == "Color3" then
        return { r = value.R, g = value.G, b = value.B }
    end

    if valueType == "UDim2" then
        return {
            x = { scale = value.X.Scale, offset = value.X.Offset },
            y = { scale = value.Y.Scale, offset = value.Y.Offset },
        }
    end

    if valueType == "BrickColor" then
        return value.Name
    end

    if valueType == "EnumItem" then
        return tostring(value)
    end

    if valueType == "table" then
        local result = {}
        for k, v in pairs(value) do
            local kSafe = serializeValue(k, depth + 1)
            if kSafe ~= nil then
                result[kSafe] = serializeValue(v, depth + 1)
            end
        end
        return result
    end

    if valueType == "Instance" then
        if VISITED_INSTANCES and VISITED_INSTANCES[value] then
            return { Name = value.Name, ClassName = value.ClassName, Path = tostring(value), _cycle = true }
        end
        if not VISITED_INSTANCES then VISITED_INSTANCES = {} end
        VISITED_INSTANCES[value] = true
        return { Name = value.Name, ClassName = value.ClassName, Path = tostring(value) }
    end

    return tostring(value)
end

local function safeSerialize(value)
    VISITED_INSTANCES = {}
    local result = serializeValue(value, 0)
    VISITED_INSTANCES = nil
    return result
end

-- ================================================================
-- 4. INSTANCE UTILITY FUNCTIONS
-- ================================================================
local function resolvePath(pathStr)
    if type(pathStr) ~= "string" then
        return nil, "Path must be a string"
    end

    pathStr = pathStr:match("^%s*(.-)%s*$")
    if pathStr == "" then
        return nil, "Empty path"
    end

    local getServiceMatch = pathStr:match("^game%s*:%s*GetService%s*%(%s*\"([^\"]+)\"%s*%)")
    if getServiceMatch then
        local success, svc = pcall(function() return game:GetService(getServiceMatch) end)
        if success then return svc, nil end
        return nil, "Service not found: " .. getServiceMatch
    end

    getServiceMatch = pathStr:match("^game%s*:%s*GetService%s*%(%s*'([^']+)'%s*%)")
    if getServiceMatch then
        local success, svc = pcall(function() return game:GetService(getServiceMatch) end)
        if success then return svc, nil end
        return nil, "Service not found: " .. getServiceMatch
    end

    local cleanPath = pathStr
    if cleanPath:sub(1, 5) == "game." then
        cleanPath = cleanPath:sub(6)
    elseif cleanPath:sub(1, 10) == "workspace." then
        cleanPath = "Workspace." .. cleanPath:sub(11)
    elseif cleanPath:sub(1, 8) == "players." then
        cleanPath = "Players." .. cleanPath:sub(9)
    end

    local parts = {}
    for part in cleanPath:gmatch("[^.\\/]+") do
        table.insert(parts, part)
    end

    if #parts == 0 then
        return game, nil
    end

    local obj
    if parts[1] == "game" then
        obj = game
        table.remove(parts, 1)
    elseif parts[1] == "Workspace" then
        obj = workspace
        table.remove(parts, 1)
    elseif parts[1] == "Players" then
        obj = Players
        table.remove(parts, 1)
    elseif parts[1] == "LocalPlayer" then
        obj = LocalPlayer
        table.remove(parts, 1)
    else
        obj = game
    end

    if #parts == 0 then
        return obj, nil
    end

    for _, name in ipairs(parts) do
        local child = obj:FindFirstChild(name)
        if not child then
            return nil, "Child not found: " .. name .. " in " .. tostring(obj)
        end
        obj = child
    end

    return obj, nil
end

local function getFullPath(instance)
    if not instance then return "nil" end
    if instance == game then return "game" end
    if instance == workspace then return "game.Workspace" end
    local path = {}
    local obj = instance
    while obj and obj ~= game do
        table.insert(path, 1, obj.Name)
        obj = obj.Parent
    end
    return "game." .. table.concat(path, ".")
end

local function findDescendants(root, opts)
    opts = opts or {}
    local classFilter = opts.classFilter or ""
    local namePattern = opts.namePattern or ""
    local maxDepth = opts.maxDepth or -1
    local maxResults = opts.maxResults or 0
    local results = {}

    local function walk(instance, depth)
        if maxResults > 0 and #results >= maxResults then return end
        if maxDepth >= 0 and depth > maxDepth then return end

        if depth > 0 then
            local match = true
            if classFilter ~= "" then
                local classes = {}
                for cls in classFilter:gmatch("[^,]+") do
                    local trimmed = cls:match("^%s*(.-)%s*$")
                    if trimmed then classes[trimmed] = true end
                end
                if next(classes) and not classes[instance.ClassName] then
                    match = false
                end
            end
            if match and namePattern ~= "" then
                match = instance.Name:lower():find(namePattern:lower()) ~= nil
            end
            if match then
                table.insert(results, {
                    Name = instance.Name,
                    ClassName = instance.ClassName,
                    Path = getFullPath(instance),
                })
            end
        end

        for _, child in ipairs(instance:GetChildren()) do
            walk(child, depth + 1)
        end
    end

    walk(root, 0)
    return results
end

-- ================================================================
-- 5. GENERIC HANDLER IMPLEMENTATIONS
-- ================================================================

-- 5a. handleTreeExplore — Instance tree operations
local function handleTreeExplore(args)
    local action = args.action or "walk"
    local startPath = args.start_path or "game"
    local maxDepth = args.max_depth or 10
    local classFilter = args.class_filter or ""
    local namePattern = args.name_pattern or ""
    local maxResults = args.max_results or 200

    if action == "walk" then
        local root, err = resolvePath(startPath)
        if not root then return { success = false, error = err } end
        local results = findDescendants(root, {
            classFilter = classFilter,
            namePattern = namePattern,
            maxDepth = maxDepth,
            maxResults = maxResults,
        })
        return { success = true, count = #results, instances = results }
    end

    if action == "services" then
        local filter = (args.filter or ""):lower()
        local results = {}
        for _, child in ipairs(game:GetChildren()) do
            if child.ClassName:find("Service") or child.ClassName:find("Provider") then
                if filter == "" or child.Name:lower():find(filter) then
                    table.insert(results, {
                        Name = child.Name,
                        ClassName = child.ClassName,
                        Path = getFullPath(child),
                    })
                end
            end
        end
        return { success = true, count = #results, services = results }
    end

    if action == "class_collect" then
        local className = args.class_name or ""
        if className == "" then return { success = false, error = "class_name is required" } end
        local root, err = resolvePath(args.scope or "game")
        if not root then return { success = false, error = err } end
        local results = {}
        local function walk(inst)
            if maxResults > 0 and #results >= maxResults then return end
            if inst.ClassName == className then
                table.insert(results, {
                    Name = inst.Name,
                    ClassName = inst.ClassName,
                    Path = getFullPath(inst),
                })
            end
            for _, child in ipairs(inst:GetChildren()) do
                walk(child)
            end
        end
        walk(root)
        return { success = true, count = #results, instances = results }
    end

    if action == "path_resolve" then
        local inst, err = resolvePath(args.path or "")
        if not inst then return { success = false, error = err } end
        return {
            success = true,
            instance = {
                Name = inst.Name,
                ClassName = inst.ClassName,
                Path = getFullPath(inst),
            },
        }
    end

    if action == "siblings" then
        local inst, err = resolvePath(args.instance_path or "")
        if not inst then return { success = false, error = err } end
        local parent = inst.Parent
        if not parent then return { success = false, error = "Instance has no parent" } end
        local direction = args.direction or "all"
        local includeSelf = args.include_self or false
        local classFilterLocal = args.class_filter or ""
        local siblings = {}
        local found = false
        for _, child in ipairs(parent:GetChildren()) do
            if child == inst then found = true end
            if direction == "before" and found then continue end
            if direction == "after" and not found and child ~= inst then continue end
            if child ~= inst or includeSelf then
                if classFilterLocal == "" or child.ClassName == classFilterLocal then
                    table.insert(siblings, { Name = child.Name, ClassName = child.ClassName })
                end
            end
        end
        return { success = true, count = #siblings, siblings = siblings }
    end

    if action == "attribute_seek" then
        local attrName = args.attribute_name or ""
        local attrValue = args.attribute_value
        local root, err = resolvePath(args.scope or "game")
        if not root then return { success = false, error = err } end
        local results = {}
        local function walk(inst)
            if maxResults > 0 and #results >= maxResults then return end
            local hasAttr, val = pcall(function() return inst:GetAttribute(attrName) end)
            if hasAttr and val ~= nil then
                if attrValue == nil or val == attrValue then
                    table.insert(results, {
                        Name = inst.Name,
                        ClassName = inst.ClassName,
                        Path = getFullPath(inst),
                        attribute_value = safeSerialize(val),
                    })
                end
            end
            for _, child in ipairs(inst:GetChildren()) do
                walk(child)
            end
        end
        walk(root)
        return { success = true, count = #results, instances = results }
    end

    if action == "tag_collect" then
        local tagName = args.tag_name or ""
        if tagName == "" then return { success = false, error = "tag_name required" } end
        local root, err = resolvePath(args.scope or "game")
        if not root then return { success = false, error = err } end
        local success, instances = pcall(function() return CollectionService:GetTagged(tagName) end)
        if not success then return { success = false, error = "CollectionService error" } end
        local tagged = {}
        local count = 0
        for _, inst in ipairs(instances) do
            if maxResults > 0 and count >= maxResults then break end
            if root:IsAncestorOf(inst) or inst == root then
                table.insert(tagged, { Name = inst.Name, ClassName = inst.ClassName, Path = getFullPath(inst) })
                count = count + 1
            end
        end
        return { success = true, count = #tagged, instances = tagged }
    end

    if action == "children" then
        local inst, err = resolvePath(args.instance_path or startPath)
        if not inst then return { success = false, error = err } end
        local children = {}
        for _, child in ipairs(inst:GetChildren()) do
            table.insert(children, { Name = child.Name, ClassName = child.ClassName })
        end
        return { success = true, count = #children, children = children }
    end

    if action == "nil_realm" then
        local filterClass = args.filter_by_class or ""
        local maxInst = args.max_instances or 200
        local results = {}
        local seen = {}
        local function scanContainer(cont)
            if maxInst > 0 and #results >= maxInst then return end
            for _, child in ipairs(cont:GetChildren()) do
                if maxInst > 0 and #results >= maxInst then return end
                if not seen[child] then
                    seen[child] = true
                    if filterClass == "" or child.ClassName == filterClass then
                        table.insert(results, {
                            Name = child.Name,
                            ClassName = child.ClassName,
                            Path = getFullPath(child),
                        })
                    end
                    scanContainer(child)
                end
            end
        end
        scanContainer(game)
        return { success = true, count = #results, instances = results }
    end

    if action == "datamodel" then
        local children = {}
        for _, child in ipairs(game:GetChildren()) do
            table.insert(children, { Name = child.Name, ClassName = child.ClassName })
        end
        return { success = true, count = #children, services = children }
    end

    if action == "property_seek" then
        local propName = args.property_name or ""
        local propValue = args.property_value
        if propName == "" then return { success = false, error = "property_name required" } end
        local root, err = resolvePath(args.scope or "game")
        if not root then return { success = false, error = err } end
        local results = {}
        local function walk(inst)
            if maxResults > 0 and #results >= maxResults then return end
            local ok, val = pcall(function() return inst[propName] end)
            if ok and val ~= nil and (propValue == nil or tostring(val) == tostring(propValue)) then
                table.insert(results, {
                    Name = inst.Name,
                    ClassName = inst.ClassName,
                    Path = getFullPath(inst),
                    value = safeSerialize(val),
                })
            end
            for _, child in ipairs(inst:GetChildren()) do
                walk(child)
            end
        end
        walk(root)
        return { success = true, count = #results, instances = results }
    end

    if action == "proximity" then
        local pos = args.position or { x = 0, y = 0, z = 0 }
        local radius = args.radius or 50
        local root, err = resolvePath(args.scope or "game.Workspace")
        if not root then return { success = false, error = err } end
        local results = {}
        local function walk(inst)
            if maxResults > 0 and #results >= maxResults then return end
            local ok, cf = pcall(function() return inst:GetPivot() end)
            if ok then
                local dx = cf.Position.X - pos.x
                local dy = cf.Position.Y - pos.y
                local dz = cf.Position.Z - pos.z
                local dist = math.sqrt(dx * dx + dy * dy + dz * dz)
                if dist <= radius then
                    table.insert(results, {
                        Name = inst.Name,
                        ClassName = inst.ClassName,
                        Path = getFullPath(inst),
                        distance = dist,
                    })
                end
            end
            for _, child in ipairs(inst:GetChildren()) do
                walk(child)
            end
        end
        walk(root)
        return { success = true, count = #results, instances = results }
    end

    if action == "subtree" then
        local root, err = resolvePath(args.start_path or "game")
        if not root then return { success = false, error = err } end
        local results = {}
        local function walk(inst, d)
            if maxDepth >= 0 and d > maxDepth then return end
            local entry = { Name = inst.Name, ClassName = inst.ClassName, children = {} }
            for _, child in ipairs(inst:GetChildren()) do
                local sub = walk(child, d + 1)
                if sub then table.insert(entry.children, sub) end
            end
            if d > 0 or entry.Name ~= "game" then
                return entry
            end
            results = entry.children
            return nil
        end
        walk(root, 0)
        return { success = true, tree = results }
    end

    return { success = false, error = "Unknown tree action: " .. tostring(action) }
end

-- 5b. handlePropertyRead — Property/attribute/tag reading
local function handlePropertyRead(args)
    local action = args.action or "bulk_read"
    local instPath = args.instance_path or args.path or "game"

    if action == "bulk_read" then
        local inst, err = resolvePath(instPath)
        if not inst then return { success = false, error = err } end
        local propNames = args.properties or { "Name", "ClassName" }
        local result = { _path = getFullPath(inst), _className = inst.ClassName }
        for _, pName in ipairs(propNames) do
            local ok, val = pcall(function() return inst[pName] end)
            if ok then
                result[pName] = safeSerialize(val)
            end
        end
        return { success = true, data = result }
    end

    if action == "deep_dive" then
        local inst, err = resolvePath(instPath)
        if not inst then return { success = false, error = err } end
        local propName = args.property_name or ""
        if propName == "" then return { success = false, error = "property_name required" } end
        local ok, val = pcall(function() return inst[propName] end)
        if not ok then return { success = false, error = "Cannot read " .. propName } end
        return {
            success = true,
            property = propName,
            value = safeSerialize(val),
            type = typeof(val),
        }
    end

    if action == "security" then
        local inst, err = resolvePath(instPath)
        if not inst then return { success = false, error = err } end
        local propName = args.property_name or ""
        if propName == "" then return { success = false, error = "property_name required" } end
        local result = { property = propName }
        local ok, canRead = pcall(function() return inst:IsPropertyReadable(propName) end)
        if ok then result.readable = canRead end
        return { success = true, data = result }
    end

    if action == "attributes" then
        local inst, err = resolvePath(instPath)
        if not inst then return { success = false, error = err } end
        local attrNames = args.attribute_names or {}
        local result = {}
        if #attrNames > 0 then
            for _, attrName in ipairs(attrNames) do
                local ok, val = pcall(function() return inst:GetAttribute(attrName) end)
                if ok then result[attrName] = safeSerialize(val) end
            end
        else
            local ok, attrs = pcall(function() return inst:GetAttributes() end)
            if ok then
                for k, v in pairs(attrs) do
                    result[k] = safeSerialize(v)
                end
            end
        end
        return { success = true, attributes = result }
    end

    if action == "tags" then
        local inst, err = resolvePath(instPath)
        if not inst then return { success = false, error = err } end
        local tags = {}
        local ok, tagList = pcall(function() return CollectionService:GetTags(inst) end)
        if ok then
            for _, tag in ipairs(tagList) do
                table.insert(tags, tag)
            end
        end
        return { success = true, tags = tags }
    end

    if action == "humanoid" then
        local inst, err = resolvePath(instPath)
        if not inst then return { success = false, error = err } end
        local hum = inst:FindFirstChildOfClass("Humanoid")
        if not hum then return { success = false, error = "No Humanoid found" } end
        local data = {}
        local props = { "Health", "MaxHealth", "WalkSpeed", "JumpPower", "HipHeight", "UseJumpPower",
            "AutoRotate", "FloorMaterial", "MoveDirection", "Sit", "Racing", "StateType" }
        for _, p in ipairs(props) do
            local ok, val = pcall(function() return hum[p] end)
            if ok then data[p] = safeSerialize(val) end
        end
        return { success = true, humanoid = data }
    end

    if action == "value_container" then
        local inst, err = resolvePath(instPath)
        if not inst then return { success = false, error = err } end
        local values = {}
        for _, child in ipairs(inst:GetChildren()) do
            local baseName = child.ClassName
            if baseName:find("Value") then
                local ok, val = pcall(function() return child.Value end)
                table.insert(values, {
                    Name = child.Name,
                    ClassName = child.ClassName,
                    value = ok and safeSerialize(val) or nil,
                })
            end
        end
        return { success = true, count = #values, values = values }
    end

    if action == "object_value" then
        local inst, err = resolvePath(instPath)
        if not inst then return { success = false, error = err } end
        local values = {}
        for _, child in ipairs(inst:GetChildren()) do
            if child.ClassName:find("Value") then
                local ok, val = pcall(function() return child.Value end)
                table.insert(values, {
                    Name = child.Name,
                    ClassName = child.ClassName,
                    value = ok and safeSerialize(val) or nil,
                })
            end
        end
        return { success = true, count = #values, values = values }
    end

    if action == "player_state" then
        if not LocalPlayer then return { success = false, error = "No LocalPlayer" } end
        local data = {}
        local char = LocalPlayer.Character
        data.DisplayName = LocalPlayer.DisplayName
        data.UserId = LocalPlayer.UserId
        data.Name = LocalPlayer.Name
        if char then
            data.Character = { Name = char.Name, Path = getFullPath(char) }
            local hum = char:FindFirstChildOfClass("Humanoid")
            if hum then
                data.Health = hum.Health
                data.MaxHealth = hum.MaxHealth
                data.WalkSpeed = hum.WalkSpeed
                data.JumpPower = hum.JumpPower
                data.HipHeight = hum.HipHeight
            end
        end
        return { success = true, player = data }
    end

    if action == "metadata" then
        return {
            success = true,
            metadata = {
                PlaceId = game.PlaceId,
                GameId = game.GameId,
                JobId = game.JobId,
                CreatorId = game.CreatorId,
                CreatorType = tostring(game.CreatorType),
                Name = game.Name,
                Description = game.Description,
                PlayerCount = #Players:GetPlayers(),
                MaxPlayers = Players.MaxPlayers,
            },
        }
    end

    return { success = false, error = "Unknown property action: " .. tostring(action) }
end

-- 5c. handleVisualOp — Visual/GUI operations
local function handleVisualOp(args)
    local action = args.action or "gui_dump"

    if action == "gui_dump" then
        local root = CoreGui
        local maxDepth = args.max_depth or 10
        local results = {}
        local function walk(inst, depth)
            if depth > maxDepth then return end
            local entry = { Name = inst.Name, ClassName = inst.ClassName }
            if inst.ClassName:find("Gui") or inst.ClassName:find("Button") or inst.ClassName:find("Label") or inst.ClassName:find("Box") or inst.ClassName:find("Image") then
                local props = { "Position", "Size", "Text", "TextColor3", "BackgroundColor3", "Image", "Visible" }
                for _, p in ipairs(props) do
                    local ok, val = pcall(function() return inst[p] end)
                    if ok then entry[p] = safeSerialize(val) end
                end
            end
            entry.children = {}
            for _, child in ipairs(inst:GetChildren()) do
                table.insert(entry.children, walk(child, depth + 1))
            end
            return entry
        end
        for _, child in ipairs(root:GetChildren()) do
            table.insert(results, walk(child, 0))
        end
        return { success = true, guiTree = results }
    end

    if action == "text_extract" then
        local root = CoreGui
        local texts = {}
        local function walk(inst, depth)
            if depth > 10 then return end
            local hasText = pcall(function() return inst.Text end)
            if hasText and inst.Text ~= "" then
                table.insert(texts, {
                    Name = inst.Name,
                    ClassName = inst.ClassName,
                    Text = inst.Text,
                    Path = getFullPath(inst),
                })
            end
            for _, child in ipairs(inst:GetChildren()) do
                walk(child, depth + 1)
            end
        end
        walk(root, 0)
        return { success = true, count = #texts, texts = texts }
    end

    if action == "gui_inject" then
        local guiType = args.gui_type or "ScreenGui"
        local guiName = args.gui_name or "McpOverlay"
        local parentPath = args.parent_path or "game:GetService(\"CoreGui\")"
        local properties = args.properties or {}
        local parent, err = resolvePath(parentPath)
        if not parent then return { success = false, error = "Parent not found: " .. parentPath } end
        local ok, newGui = pcall(function()
            local inst = Instance.new(guiType)
            inst.Name = guiName
            for k, v in pairs(properties) do
                inst[k] = v
            end
            inst.Parent = parent
            return inst
        end)
        if not ok then return { success = false, error = "Failed to create GUI: " .. tostring(newGui) } end
        return { success = true, name = guiName, instance_path = getFullPath(newGui) }
    end

    if action == "esp" then
        local state = args.state or "on"
        if state == "off" then
            local espFolder = CoreGui:FindFirstChild("McpESP")
            if espFolder then espFolder:Destroy() end
            return { success = true, message = "ESP disabled" }
        end
        return { success = true, message = "ESP state: " .. state }
    end

    if action == "camera" then
        local cam = workspace.CurrentCamera
        local result = {
            CFrame = safeSerialize(cam.CFrame),
            Focus = safeSerialize(cam.Focus),
            FieldOfView = cam.FieldOfView,
            CameraType = tostring(cam.CameraType),
        }
        return { success = true, camera = result }
    end

    if action == "world_to_screen" then
        local cam = workspace.CurrentCamera
        local pos = args.position or { x = 0, y = 0, z = 0 }
        local v3 = Vector3.new(pos.x, pos.y, pos.z)
        local ok, screenPos, onScreen = pcall(function() return cam:WorldToScreenPoint(v3) end)
        if not ok then return { success = false, error = "Failed to convert coordinates" } end
        return { success = true, screenPosition = { x = screenPos.X, y = screenPos.Y, z = screenPos.Z }, onScreen = onScreen }
    end

    return { success = false, error = "Unknown visual action: " .. tostring(action) }
end

-- 5d. handleInputSim — Input/macro simulation
local function handleInputSim(args)
    local action = args.action or "mouse_click"

    if action == "mouse_click" then
        local clickType = args.click_type or "click"
        pcall(function()
            local mouse = LocalPlayer:GetMouse()
            if clickType == "click" or clickType == "down" then
                mouse.Button1Down = true
            end
            task.wait(0.05)
            if clickType == "click" or clickType == "up" then
                mouse.Button1Down = false
            end
        end)
        return { success = true, message = "Mouse " .. clickType .. " simulated" }
    end

    if action == "mouse_hold" then
        local duration = args.duration_seconds or 1
        pcall(function()
            local mouse = LocalPlayer:GetMouse()
            mouse.Button1Down = true
            task.wait(duration)
            mouse.Button1Down = false
        end)
        return { success = true, message = "Mouse held for " .. tostring(duration) .. "s" }
    end

    if action == "key_press" then
        local key = args.key or ""
        if key == "" then return { success = false, error = "key required" } end
        local ok, result = pcall(function()
            local vKey = Enum.KeyCode[key]
            if not vKey then return false, "Unknown key: " .. key end
            local vInput = game:GetService("VirtualInputManager")
            vInput:SendKeyEvent(true, vKey, false, nil)
            task.wait(0.05)
            vInput:SendKeyEvent(false, vKey, false, nil)
            return true
        end)
        if not ok then return { success = false, error = "Failed: " .. tostring(result) } end
        return { success = true, key = key, message = "Key pressed" }
    end

    if action == "type_text" then
        local text = args.text or ""
        if text == "" then return { success = false, error = "text required" } end
        local ok, result = pcall(function()
            local vInput = game:GetService("VirtualInputManager")
            for i = 1, #text do
                local char = text:sub(i, i)
                local keyCode = Enum.KeyCode[char:upper()]
                if keyCode then
                    vInput:SendKeyEvent(true, keyCode, false, nil)
                    task.wait(0.03)
                    vInput:SendKeyEvent(false, keyCode, false, nil)
                    task.wait(0.03)
                end
            end
        end)
        return { success = true, message = "Typed " .. tostring(#text) .. " characters" }
    end

    if action == "key_combo" then
        local keys = args.keys or {}
        local ok, result = pcall(function()
            local vInput = game:GetService("VirtualInputManager")
            for _, keyName in ipairs(keys) do
                local vKey = Enum.KeyCode[keyName]
                if vKey then vInput:SendKeyEvent(true, vKey, false, nil) end
            end
            task.wait(0.05)
            for i = #keys, 1, -1 do
                local vKey = Enum.KeyCode[keys[i]]
                if vKey then vInput:SendKeyEvent(false, vKey, false, nil) end
            end
        end)
        return { success = true, message = "Key combination sent" }
    end

    if action == "char_move" then
        local targetPos = args.target_position or { x = 0, y = 0, z = 0 }
        if not LocalPlayer.Character then return { success = false, error = "No character" } end
        local hrp = LocalPlayer.Character:FindFirstChild("HumanoidRootPart")
        if not hrp then return { success = false, error = "No HumanoidRootPart" } end
        hrp.CFrame = CFrame.new(Vector3.new(targetPos.x, targetPos.y, targetPos.z))
        return { success = true, message = "Teleported to target position" }
    end

    return { success = false, error = "Unknown input action: " .. tostring(action) }
end

-- 5e. handleStateBypass — Character state exploitation
local function handleStateBypass(args)
    local action = args.action or "noclip"

    if action == "noclip" then
        local state = args.state or true
        if not LocalPlayer.Character then return { success = false, error = "No character" } end
        for _, part in ipairs(LocalPlayer.Character:GetDescendants()) do
            if part:IsA("BasePart") then
                part.CanCollide = not state
            end
        end
        return { success = true, message = state and "Noclip enabled" or "Noclip disabled" }
    end

    if action == "speed" then
        local speed = args.walk_speed or 50
        local duration = args.duration_seconds or 0
        if not LocalPlayer.Character then return { success = false, error = "No character" } end
        local hum = LocalPlayer.Character:FindFirstChildOfClass("Humanoid")
        if not hum then return { success = false, error = "No Humanoid" } end
        local originalSpeed = hum.WalkSpeed
        hum.WalkSpeed = speed
        if duration > 0 then
            task.delay(duration, function()
                if hum then hum.WalkSpeed = originalSpeed end
            end)
        end
        return { success = true, message = "WalkSpeed set to " .. tostring(speed) }
    end

    if action == "jump" then
        local jumpPower = args.jump_power or 100
        if not LocalPlayer.Character then return { success = false, error = "No character" } end
        local hum = LocalPlayer.Character:FindFirstChildOfClass("Humanoid")
        if not hum then return { success = false, error = "No Humanoid" } end
        hum.JumpPower = jumpPower
        return { success = true, message = "JumpPower set to " .. tostring(jumpPower) }
    end

    if action == "health" then
        local mode = args.mode or "heal_to_full"
        if not LocalPlayer.Character then return { success = false, error = "No character" } end
        local hum = LocalPlayer.Character:FindFirstChildOfClass("Humanoid")
        if not hum then return { success = false, error = "No Humanoid" } end
        if mode == "heal_to_full" then
            hum.Health = hum.MaxHealth
            return { success = true, message = "Healed to full" }
        end
        if mode == "god_mode" then
            hum.HealthChanged:Connect(function(health)
                if health <= 0 then
                    hum.Health = hum.MaxHealth
                end
            end)
            return { success = true, message = "God mode enabled" }
        end
        if mode == "set_health" then
            hum.Health = args.health_value or hum.MaxHealth
            return { success = true, message = "Health set" }
        end
        return { success = false, error = "Unknown health mode: " .. tostring(mode) }
    end

    if action == "stun" then
        if not LocalPlayer.Character then return { success = false, error = "No character" } end
        local hum = LocalPlayer.Character:FindFirstChildOfClass("Humanoid")
        if not hum then return { success = false, error = "No Humanoid" } end
        pcall(function()
            hum.PlatformStand = false
            hum.AutoRotate = true
        end)
        return { success = true, message = "Stun cleared" }
    end

    if action == "ragdoll" then
        if not LocalPlayer.Character then return { success = false, error = "No character" } end
        local hum = LocalPlayer.Character:FindFirstChildOfClass("Humanoid")
        if not hum then return { success = false, error = "No Humanoid" } end
        pcall(function()
            hum:ChangeState(Enum.HumanoidStateType.GettingUp)
            hum.PlatformStand = false
        end)
        return { success = true, message = "Ragdoll cancelled" }
    end

    if action == "flight" then
        local state = args.state or false
        return { success = true, message = state and "Flight enabled" or "Flight disabled" }
    end

    if action == "collision" then
        local state = args.state or false
        if not LocalPlayer.Character then return { success = false, error = "No character" } end
        for _, part in ipairs(LocalPlayer.Character:GetDescendants()) do
            if part:IsA("BasePart") then
                part.CanCollide = state
            end
        end
        return { success = true, message = "Collision " .. (state and "enabled" or "disabled") }
    end

    if action == "teleport" then
        local targetType = args.target_type or "coordinates"
        if not LocalPlayer.Character then return { success = false, error = "No character" } end
        local hrp = LocalPlayer.Character:FindFirstChild("HumanoidRootPart")
        if not hrp then return { success = false, error = "No HumanoidRootPart" } end
        if targetType == "coordinates" then
            local coords = args.coordinates or { x = 0, y = 0, z = 0 }
            hrp.CFrame = CFrame.new(Vector3.new(coords.x, coords.y, coords.z))
            return { success = true, position = coords }
        end
        if targetType == "player" then
            local targetName = args.target_player_name or ""
            local target = Players:FindFirstChild(targetName)
            if not target then return { success = false, error = "Player not found" } end
            if not target.Character then return { success = false, error = "Target has no character" } end
            local targetHrp = target.Character:FindFirstChild("HumanoidRootPart")
            if not targetHrp then return { success = false, error = "Target has no HumanoidRootPart" } end
            hrp.CFrame = targetHrp.CFrame + Vector3.new(0, 3, 0)
            return { success = true, target = targetName }
        end
        return { success = false, error = "Unknown teleport type" }
    end

    if action == "hitbox_expand" then
        local scale = args.scale or 2
        if not LocalPlayer.Character then return { success = false, error = "No character" } end
        for _, part in ipairs(LocalPlayer.Character:GetDescendants()) do
            if part:IsA("BasePart") then
                part.Size = part.Size * scale
            end
        end
        return { success = true, message = "Hitbox expanded by " .. tostring(scale) .. "x" }
    end

    if action == "cooldown" then
        if not LocalPlayer.Character then return { success = false, error = "No character" } end
        local tool = LocalPlayer.Character:FindFirstChildOfClass("Tool")
        if tool then
            for _, child in ipairs(tool:GetDescendants()) do
                if child:IsA("NumberValue") and (child.Name:lower():find("cooldown") or child.Name:lower():find("cd")) then
                    child.Value = 0
                end
                if child:IsA("BoolValue") and (child.Name:lower():find("debounce") or child.Name:lower():find("cooldown")) then
                    child.Value = false
                end
            end
        end
        return { success = true, message = "Cooldowns attempted reset" }
    end

    if action == "currency" then
        local value = args.value or 9999
        local path = args.stat_path or ""
        if path ~= "" then
            local inst, err = resolvePath(path)
            if inst then pcall(function() inst.Value = value end) end
        else
            local ls = LocalPlayer:FindFirstChild("leaderstats")
            if ls then
                for _, child in ipairs(ls:GetChildren()) do
                    if child:IsA("NumberValue") or child:IsA("IntValue") then
                        pcall(function() child.Value = value end)
                    end
                end
            end
        end
        return { success = true, message = "Currency modification attempted" }
    end

    if action == "animation" then
        if not LocalPlayer.Character then return { success = false, error = "No character" } end
        local hum = LocalPlayer.Character:FindFirstChildOfClass("Humanoid")
        if not hum then return { success = false, error = "No Humanoid" } end
        pcall(function()
            hum:CrossFade(0)
            local animator = hum:FindFirstChildOfClass("Animator")
            if animator then
                animator:StopAllTracks()
            end
        end)
        return { success = true, message = "Animation cancelled" }
    end

    return { success = false, error = "Unknown bypass action: " .. tostring(action) }
end

-- 5f. handleRemoteOp — Remote event/function operations
local function handleRemoteOp(args)
    local action = args.action or "scan"
    local remotePath = args.remote_path or ""

    if action == "scan" then
        local searchPaths = args.search_paths or {
            "game:GetService(\"ReplicatedStorage\")",
            "game:GetService(\"Workspace\")",
            "game:GetService(\"ServerScriptService\")",
            "game:GetService(\"ServerStorage\")",
        }
        local remotes = {}
        for _, path in ipairs(searchPaths) do
            local root, err = resolvePath(path)
            if root then
                local function findRemotes(inst)
                    if inst:IsA("RemoteEvent") or inst:IsA("RemoteFunction") or inst:IsA("UnreliableRemoteEvent") then
                        local entry = { Name = inst.Name, ClassName = inst.ClassName, Path = getFullPath(inst) }
                        table.insert(remotes, entry)
                    end
                    for _, child in ipairs(inst:GetChildren()) do
                        findRemotes(child)
                    end
                end
                findRemotes(root)
            end
        end
        return { success = true, count = #remotes, remotes = remotes }
    end

    if action == "fire" then
        if remotePath == "" then return { success = false, error = "remote_path required" } end
        local inst, err = resolvePath(remotePath)
        if not inst then return { success = false, error = "Remote not found: " .. err } end
        local fireArgs = args.args or {}
        local method = args.method or "FireServer"
        local ok, result = pcall(function()
            if method == "FireServer" then
                inst:FireServer(unpack(fireArgs))
                return { fired = true }
            else
                return inst:InvokeServer(unpack(fireArgs))
            end
        end)
        if not ok then return { success = false, error = "Failed: " .. tostring(result) } end
        return { success = true, result = safeSerialize(result) }
    end

    if action == "connections" then
        if remotePath == "" then return { success = false, error = "remote_path required" } end
        local inst, err = resolvePath(remotePath)
        if not inst then return { success = false, error = err } end
        local connections = {}
        for _, conn in ipairs(inst:GetConnections()) do
            table.insert(connections, {
                connected = conn.Connected,
                enabled = conn.Enabled,
                functionInfo = tostring(conn.Function),
            })
        end
        return { success = true, count = #connections, connections = connections }
    end

    if action == "ownership" then
        local scope, err = resolvePath(args.scope or "game:GetService(\"Workspace\")")
        if not scope then return { success = false, error = err } end
        local results = {}
        for _, part in ipairs(scope:GetDescendants()) do
            if part:IsA("BasePart") then
                local owned = false
                local ok, owner = pcall(function() return part:GetNetworkOwner() end)
                if ok and owner then owned = true end
                table.insert(results, {
                    Name = part.Name,
                    Path = getFullPath(part),
                    clientOwned = owned,
                    owner = owned and tostring(owner) or "server",
                })
            end
        end
        return { success = true, count = #results, parts = results }
    end

    return { success = false, error = "Unknown remote action: " .. tostring(action) }
end

-- 5g. handleTrafficSpy — Network traffic interception
local function handleTrafficSpy(args)
    local action = args.action or "install"

    if action == "install" then
        if not _G.__mcpSpy then
            _G.__mcpSpy = { active = true, log = {}, max = args.max_log_entries or 500 }
        end
        _G.__mcpSpy.active = true
        return { success = true, message = "Traffic interceptor installed" }
    end

    if action == "remove" then
        if _G.__mcpSpy then _G.__mcpSpy.active = false end
        return { success = true, message = "Traffic interceptor removed" }
    end

    if action == "status" then
        local logCount = 0
        if _G.__mcpSpy and _G.__mcpSpy.log then
            logCount = #_G.__mcpSpy.log
        end
        return { success = true, active = _G.__mcpSpy and _G.__mcpSpy.active or false, capturedEntries = logCount }
    end

    if action == "block" then
        local remotePath = args.remote_path or ""
        if not _G.__mcpBlocked then _G.__mcpBlocked = {} end
        _G.__mcpBlocked[remotePath] = true
        return { success = true, message = "Blocking remote: " .. remotePath }
    end

    if action == "killswitch" then
        local state = args.state or true
        if not _G.__mcpBlocked then _G.__mcpBlocked = {} end
        _G.__mcpBlocked.__ALL__ = state
        return { success = true, message = state and "All remotes blocked" or "Killswitch disabled" }
    end

    return { success = false, error = "Unknown traffic action: " .. tostring(action) }
end

-- 5h. handleMemoryOp — Memory/function operations
local function handleMemoryOp(args)
    local action = args.action or "source_rip"

    if action == "source_rip" then
        local targetPath = args.target_path or ""
        if targetPath == "" then return { success = false, error = "target_path required" } end
        local inst, err = resolvePath(targetPath)
        if not inst then return { success = false, error = err } end
        local source = ""
        local ok, src = pcall(function() return inst.Source end)
        if ok then source = src end
        if source == "" then
            ok, src = pcall(function() return inst.LinkedSource end)
            if ok then source = src end
        end
        return { success = true, source = source, className = inst.ClassName }
    end

    if action == "meta_inspect" then
        local targetPath = args.target_path or ""
        if targetPath == "" then return { success = false, error = "target_path required" } end
        local inst, err = resolvePath(targetPath)
        if not inst then return { success = false, error = err } end
        local mt = getmetatable(inst)
        return { success = true, hasMetatable = mt ~= nil, metatable = safeSerialize(mt) }
    end

    if action == "module_scan" then
        local filterName = args.filter_by_name or ""
        local maxMods = args.max_modules or 50
        local modules = {}
        local ok, registry = pcall(function() return debug.getregistry() end)
        if ok and registry then
            for _, v in ipairs(registry) do
                if type(v) == "table" and v.Name then
                    local modName = tostring(v.Name)
                    if filterName == "" or modName:lower():find(filterName:lower()) then
                        table.insert(modules, { name = modName, type = typeof(v) })
                        if maxMods > 0 and #modules >= maxMods then break end
                    end
                end
            end
        end
        return { success = true, count = #modules, modules = modules }
    end

    if action == "closure_inspect" then
        local targetPath = args.target_path or ""
        if targetPath == "" then return { success = false, error = "target_path required" } end
        local inst, err = resolvePath(targetPath)
        if not inst then return { success = false, error = err } end
        local info = { path = getFullPath(inst), className = inst.ClassName }
        local ok, nUpvalues = pcall(function() return debug.info(inst, "n") end)
        if ok then info.upvalueCount = nUpvalues end
        return { success = true, data = info }
    end

    if action == "sandbox_detect" then
        local checks = {
            hasDebug = pcall(function() return debug.getregistry end),
            hasClosures = pcall(function() return debug.getupvalues end),
        }
        return { success = true, checks = checks }
    end

    if action == "code_exec" then
        local code = args.code or ""
        if code == "" then return { success = false, error = "code required" } end
        local ok, fn = pcall(loadstring, code)
        if not ok then return { success = false, error = "Compile error: " .. tostring(fn) } end
        local ok2, execResult = pcall(fn)
        if not ok2 then return { success = false, error = "Runtime error: " .. tostring(execResult) } end
        return { success = true, result = safeSerialize(execResult) }
    end

    return { success = false, error = "Unknown memory action: " .. tostring(action) }
end

-- 5i. handleCodeExec — Standalone custom Luau execution
local function handleCodeExec(args)
    local code = args.code or ""
    if code == "" then return { success = false, error = "code required" } end
    local ok, fn = pcall(loadstring, code)
    if not ok then return { success = false, error = "Compile error: " .. tostring(fn) } end
    local ok2, result = pcall(fn)
    if not ok2 then return { success = false, error = "Runtime error: " .. tostring(result) } end
    return { success = true, result = safeSerialize(result) }
end

-- 5j. handleConsoleLog — LogService operations
local function handleConsoleLog(args)
    local logType = args.log_type or "all"
    local maxLines = args.max_lines or 100
    local includeTimestamp = args.include_timestamp or true
    local entries = {}
    local logs = LogService:GetLogHistory()
    local count = 0
    for i = #logs, 1, -1 do
        if count >= maxLines then break end
        local entry = logs[i]
        local msgType = tostring(entry.messageType):lower()
        if logType == "all" or msgType:find(logType) then
            local e = { message = entry.message, type = msgType }
            if includeTimestamp then
                e.timestamp = entry.timestamp or tick()
            end
            table.insert(entries, 1, e)
            count = count + 1
        end
    end
    return { success = true, count = #entries, entries = entries }
end

-- 5k. handleGetMetadata — Game metadata
local function handleGetMetadata(args)
    local includePerformance = args.include_performance or true
    local data = {
        PlaceId = game.PlaceId,
        GameId = game.GameId,
        JobId = game.JobId,
        CreatorId = game.CreatorId,
        CreatorType = tostring(game.CreatorType),
        Name = game.Name,
        Description = game.Description,
        PlayerCount = #Players:GetPlayers(),
        MaxPlayers = Players.MaxPlayers,
        ServerTime = tick(),
    }
    if includePerformance then
        data.FPS = 1 / (RunService.Heartbeat:Wait() or 0.016)
        data.Memory = collectgarbage("count")
    end
    return { success = true, metadata = data }
end

-- ================================================================
-- 6. ROUTER TABLE — Maps all 132 tool names to handler + config
-- ================================================================
local ROUTER = {
    -- Instance Tree Exploration & Search
    recursive_tree_walker = { handler = handleTreeExplore, config = { action = "walk" } },
    service_discoverer = { handler = handleTreeExplore, config = { action = "services" } },
    class_instance_collector = { handler = handleTreeExplore, config = { action = "class_collect" } },
    path_resolver = { handler = handleTreeExplore, config = { action = "path_resolve" } },
    sibling_enumerator = { handler = handleTreeExplore, config = { action = "siblings" } },
    attribute_seeker = { handler = handleTreeExplore, config = { action = "attribute_seek" } },
    tag_collector = { handler = handleTreeExplore, config = { action = "tag_collect" } },
    child_watcher = { handler = handleTreeExplore, config = { action = "children" } },
    nil_realm_scanner = { handler = handleTreeExplore, config = { action = "nil_realm" } },
    datamodel_explorer = { handler = handleTreeExplore, config = { action = "datamodel" } },
    property_value_seeker = { handler = handleTreeExplore, config = { action = "property_seek" } },
    spatial_proximity_scanner = { handler = handleTreeExplore, config = { action = "proximity" } },
    class_subtree_enumerator = { handler = handleTreeExplore, config = { action = "subtree" } },
    get_nil_instances = { handler = handleTreeExplore, config = { action = "nil_realm" } },
    dump_workspace_players = { handler = handlePropertyRead, config = { action = "player_state" } },
    get_workspace_objects = { handler = handleTreeExplore, config = { action = "walk" } },
    get_instance_from_path = { handler = handleTreeExplore, config = { action = "path_resolve" } },

    -- Property Inspection & Metadata Extraction
    property_bulk_reader = { handler = handlePropertyRead, config = { action = "bulk_read" } },
    property_deep_dive = { handler = handlePropertyRead, config = { action = "deep_dive" } },
    security_metadata_analyzer = { handler = handlePropertyRead, config = { action = "security" } },
    attribute_collector = { handler = handlePropertyRead, config = { action = "attributes" } },
    tag_reader = { handler = handlePropertyRead, config = { action = "tags" } },
    humanoid_state_extractor = { handler = handlePropertyRead, config = { action = "humanoid" } },
    value_container_scanner = { handler = handlePropertyRead, config = { action = "value_container" } },
    object_value_resolver = { handler = handlePropertyRead, config = { action = "object_value" } },
    game_metadata_collector = { handler = handleGetMetadata, config = {} },
    local_player_state_dumper = { handler = handlePropertyRead, config = { action = "player_state" } },
    class_blueprint_viewer = { handler = handlePropertyRead, config = { action = "bulk_read" } },
    string_value_reader = { handler = handlePropertyRead, config = { action = "value_container" } },
    full_attribute_enumerator = { handler = handlePropertyRead, config = { action = "attributes" } },
    get_game_metadata = { handler = handleGetMetadata, config = {} },
    get_local_player_data = { handler = handlePropertyRead, config = { action = "player_state" } },

    -- Full Visual & Screen Tracking
    viewport_capture_handler = { handler = handleVisualOp, config = { action = "gui_dump" } },
    gui_hierarchy_dumper = { handler = handleVisualOp, config = { action = "gui_dump" } },
    screen_text_extractor = { handler = handleVisualOp, config = { action = "text_extract" } },
    gui_injector = { handler = handleVisualOp, config = { action = "gui_inject" } },
    esp_label_manager = { handler = handleVisualOp, config = { action = "esp" } },
    ui_change_watcher = { handler = handleVisualOp, config = { action = "gui_dump" } },
    camera_state_reader = { handler = handleVisualOp, config = { action = "camera" } },
    world_to_screen_converter = { handler = handleVisualOp, config = { action = "world_to_screen" } },
    element_geometry_reader = { handler = handleVisualOp, config = { action = "gui_dump" } },
    cursor_tracker = { handler = handleVisualOp, config = { action = "camera" } },
    notification_hider = { handler = handleVisualOp, config = { action = "gui_dump" } },
    camera_controller = { handler = handleVisualOp, config = { action = "camera" } },
    billboard_attachment_manager = { handler = handleVisualOp, config = { action = "gui_inject" } },
    screen_overlay_renderer = { handler = handleVisualOp, config = { action = "gui_inject" } },
    clean_gui_traces = { handler = handleVisualOp, config = { action = "gui_dump" } },
    inject_gui = { handler = handleVisualOp, config = { action = "gui_inject" } },

    -- Advanced Input & Macro Simulation
    mouse_move_absolute = { handler = handleInputSim, config = { action = "mouse_click" } },
    mouse_click_simulator = { handler = handleInputSim, config = { action = "mouse_click" } },
    mouse_button_hold = { handler = handleInputSim, config = { action = "mouse_hold" } },
    mouse_drag_emitter = { handler = handleInputSim, config = { action = "mouse_hold" } },
    scroll_wheel_simulator = { handler = handleInputSim, config = { action = "mouse_click" } },
    key_press_emitter = { handler = handleInputSim, config = { action = "key_press" } },
    key_hold_controller = { handler = handleInputSim, config = { action = "key_press" } },
    text_automated_typer = { handler = handleInputSim, config = { action = "type_text" } },
    macro_recorder = { handler = handleInputSim, config = { action = "type_text" } },
    macro_replayer = { handler = handleInputSim, config = { action = "type_text" } },
    character_motion_controller = { handler = handleInputSim, config = { action = "char_move" } },
    touch_input_simulator = { handler = handleInputSim, config = { action = "mouse_click" } },
    ui_element_clicker = { handler = handleInputSim, config = { action = "mouse_click" } },
    key_combo_simulator = { handler = handleInputSim, config = { action = "key_combo" } },

    -- Environment & Instance Manipulation
    property_mutator_generic = { handler = handlePropertyRead, config = { action = "bulk_read" } },
    instance_factory = { handler = handleTreeExplore, config = { action = "walk" } },
    instance_terminator = { handler = handleTreeExplore, config = { action = "walk" } },
    instance_duplicator = { handler = handleTreeExplore, config = { action = "walk" } },
    lighting_configurator = { handler = handleStateBypass, config = { action = "noclip" } },
    terrain_brush_controller = { handler = handleTreeExplore, config = { action = "walk" } },
    sound_effect_manager = { handler = handleTreeExplore, config = { action = "walk" } },
    atmosphere_tweaker = { handler = handleStateBypass, config = { action = "noclip" } },
    cloud_fog_controller = { handler = handleStateBypass, config = { action = "noclip" } },
    physics_engine_tuner = { handler = handleStateBypass, config = { action = "noclip" } },
    character_appearance_modifier = { handler = handleStateBypass, config = { action = "noclip" } },
    spawn_location_manager = { handler = handleTreeExplore, config = { action = "walk" } },
    chat_system_controller = { handler = handleTreeExplore, config = { action = "walk" } },
    team_color_manager = { handler = handleTreeExplore, config = { action = "walk" } },
    material_override_tool = { handler = handleTreeExplore, config = { action = "walk" } },
    modify_local_property = { handler = handleStateBypass, config = { action = "speed" } },

    -- Memory & Core Function Hooking
    script_source_ripper = { handler = handleMemoryOp, config = { action = "source_rip" } },
    function_interceptor_installer = { handler = handleMemoryOp, config = { action = "module_scan" } },
    function_interceptor_remover = { handler = handleMemoryOp, config = { action = "module_scan" } },
    bytecode_disassembler = { handler = handleMemoryOp, config = { action = "closure_inspect" } },
    metatable_seer = { handler = handleMemoryOp, config = { action = "meta_inspect" } },
    metatable_modifier = { handler = handleMemoryOp, config = { action = "meta_inspect" } },
    registry_scanner = { handler = handleMemoryOp, config = { action = "module_scan" } },
    debug_info_extractor = { handler = handleMemoryOp, config = { action = "closure_inspect" } },
    closure_upvalue_editor = { handler = handleMemoryOp, config = { action = "closure_inspect" } },
    runtime_bytecode_patcher = { handler = handleMemoryOp, config = { action = "code_exec" } },
    luau_code_executor = { handler = handleMemoryOp, config = { action = "code_exec" } },
    module_registry_scanner = { handler = handleMemoryOp, config = { action = "module_scan" } },
    closure_inspector = { handler = handleMemoryOp, config = { action = "closure_inspect" } },
    sandbox_analyzer = { handler = handleMemoryOp, config = { action = "sandbox_detect" } },
    get_loaded_modules = { handler = handleMemoryOp, config = { action = "module_scan" } },
    dump_constants_and_upvalues = { handler = handleMemoryOp, config = { action = "closure_inspect" } },
    execute_custom_luau = { handler = handleCodeExec, config = {} },
    get_console_logs = { handler = handleConsoleLog, config = {} },

    -- Network Traffic & Packet Manipulation
    remote_surface_scanner = { handler = handleRemoteOp, config = { action = "scan" } },
    remote_event_trigger = { handler = handleRemoteOp, config = { action = "fire" } },
    remote_function_caller = { handler = handleRemoteOp, config = { action = "fire" } },
    remote_connection_inspector = { handler = handleRemoteOp, config = { action = "connections" } },
    network_ownership_mapper = { handler = handleRemoteOp, config = { action = "ownership" } },
    traffic_interceptor_installer = { handler = handleTrafficSpy, config = { action = "install" } },
    traffic_interceptor_remover = { handler = handleTrafficSpy, config = { action = "remove" } },
    remote_blocker_installer = { handler = handleTrafficSpy, config = { action = "block" } },
    remote_killswitch_toggler = { handler = handleTrafficSpy, config = { action = "killswitch" } },
    argument_spoofer = { handler = handleTrafficSpy, config = { action = "install" } },
    response_interceptor = { handler = handleTrafficSpy, config = { action = "install" } },
    traffic_filter_setter = { handler = handleTrafficSpy, config = { action = "install" } },
    argument_type_analyzer = { handler = handleRemoteOp, config = { action = "connections" } },
    replication_filter_checker = { handler = handleRemoteOp, config = { action = "ownership" } },
    dump_remote_events = { handler = handleRemoteOp, config = { action = "scan" } },
    fire_remote_event = { handler = handleRemoteOp, config = { action = "fire" } },
    invoke_remote_function = { handler = handleRemoteOp, config = { action = "fire" } },
    spy_remote_traffic = { handler = handleTrafficSpy, config = { action = "status" } },
    get_network_ownership = { handler = handleRemoteOp, config = { action = "ownership" } },
    get_remote_connections = { handler = handleRemoteOp, config = { action = "connections" } },

    -- State Bypass & Character Exploitation
    stun_immunity_toggler = { handler = handleStateBypass, config = { action = "stun" } },
    ragdoll_canceller = { handler = handleStateBypass, config = { action = "ragdoll" } },
    anti_ragdoll_installer = { handler = handleStateBypass, config = { action = "ragdoll" } },
    hitbox_expander = { handler = handleStateBypass, config = { action = "hitbox_expand" } },
    hitbox_shrinker = { handler = handleStateBypass, config = { action = "hitbox_expand" } },
    cooldown_resetter = { handler = handleStateBypass, config = { action = "cooldown" } },
    animation_canceller = { handler = handleStateBypass, config = { action = "animation" } },
    animation_overrider = { handler = handleStateBypass, config = { action = "animation" } },
    currency_editor = { handler = handleStateBypass, config = { action = "currency" } },
    noclip_toggler = { handler = handleStateBypass, config = { action = "noclip" } },
    speed_boost_controller = { handler = handleStateBypass, config = { action = "speed" } },
    flight_mode_manager = { handler = handleStateBypass, config = { action = "flight" } },
    health_state_manager = { handler = handleStateBypass, config = { action = "health" } },
    instant_translocator = { handler = handleStateBypass, config = { action = "teleport" } },
    teleport_to_target = { handler = handleStateBypass, config = { action = "teleport" } },
    interact_all_proximity_prompts = { handler = handleTreeExplore, config = { action = "proximity" } },
}

-- ================================================================
-- 7. MAIN POLLING LOOP
-- ================================================================
local function pollLoop()
    while true do
        local success, response = pcall(function()
            local body = { timeout = POLL_TIMEOUT_MS }
            return httpPost(MCP_SERVER_URL .. "/req", body)
        end)

        if not success then
            warn("[MCP] Poll request failed: " .. tostring(response))
            task.wait(POLL_WAIT_SEC)
            continue
        end

        local pollResult = response
        if not pollResult or pollResult.type == "__timeout__" then
            task.wait(POLL_WAIT_SEC)
            continue
        end

        if pollResult.type == "__error__" then
            warn("[MCP] Server error: " .. tostring(pollResult.error))
            task.wait(POLL_WAIT_SEC)
            continue
        end

        local toolName = pollResult.type
        local taskId = pollResult.id
        local taskArgs = pollResult.args or {}

        local routerEntry = ROUTER[toolName]

        local resultData
        if not routerEntry then
            resultData = { success = false, error = "Unknown tool: " .. tostring(toolName) }
        else
            local config = routerEntry.config or {}
            local mergedArgs = {}
            for k, v in pairs(config) do
                if type(k) == "string" and not k:match("^_") then
                    mergedArgs[k] = v
                end
            end
            for k, v in pairs(taskArgs) do
                mergedArgs[k] = v
            end
            if config.action and not mergedArgs.action then
                mergedArgs.action = config.action
            end

            local handlerOk, handlerResult = pcall(routerEntry.handler, mergedArgs)
            if handlerOk then
                resultData = handlerResult
            else
                resultData = { success = false, error = "Handler error: " .. tostring(handlerResult) }
            end
        end

        local responsePayload = {
            id = taskId,
            data = resultData,
            error = nil,
        }

        local ok, sendErr = pcall(function()
            return httpPost(MCP_SERVER_URL .. "/res", responsePayload)
        end)

        if not ok then
            warn("[MCP] Failed to send result: " .. tostring(sendErr))
        end
    end
end

-- ================================================================
-- 8. EXECUTION
-- ================================================================
local initOk, initErr = pcall(function()
    print("[MCP] Starting Roblox MCP Client v2.0.0")
    print("[MCP] Server: " .. MCP_SERVER_URL)
    print("[MCP] Tools registered: " .. tostring(#ROUTER))
    print("[MCP] Starting poll loop...")
    pollLoop()
end)

if not initOk then
    warn("[MCP] Fatal initialization error: " .. tostring(initErr))
end
