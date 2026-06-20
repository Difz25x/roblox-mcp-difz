--[[
    mcp.luau — Roblox Executor MCP Client

    Transport (default: WebSocket, fallback: HTTP polling):
      WS:    ws://127.0.0.1:28429/ws → register/task/result
      HTTP:  POST /req → {type, id, args, timestamp}, POST /res → {id, data, error}

    Architecture:
      Uses UNC (Universal Compatibility) functions with fallbacks.
      Every tool handler is wrapped in pcall for crash resilience.
]]

-- Wait for game to load
if not game:IsLoaded() then
    game.Loaded:Wait()
end

-- ================================================================
-- 1. CONFIGURATION (with getgenv() overrides)
-- ================================================================
local G = getgenv and getgenv() or _G
local MCP_HOST = G.MCP_HOST or "127.0.0.1"
local MCP_PORT = G.MCP_PORT or 28429
local MCP_WS_URL = "ws://" .. MCP_HOST .. ":" .. MCP_PORT .. "/ws"
local MCP_HTTP_URL = "http://" .. MCP_HOST .. ":" .. MCP_PORT
local TRANSPORT = G.MCP_TRANSPORT or "auto"
local POLL_TIMEOUT_MS = G.MCP_POLL_TIMEOUT or 25000

-- ================================================================
-- 2. UNC COMPATIBILITY LAYER
-- ================================================================

-- cloneref: safer service references
local cloneref = cloneref or function(x) return x end

-- Services (use cloneref when available)
local HttpService = cloneref(game:GetService("HttpService"))
local RunService = cloneref(game:GetService("RunService"))
local Players = cloneref(game:GetService("Players"))
local LogService = cloneref(game:GetService("LogService"))
local CoreGui = cloneref(game:GetService("CoreGui"))
local CollectionService = cloneref(game:GetService("CollectionService"))
local MarketplaceService = cloneref(game:GetService("MarketplaceService"))
local VirtualInputManager = cloneref(Instance.new("VirtualInputManager"))
local LocalPlayer = Players.LocalPlayer

-- UNC: Instances
local gethui = gethui or function() return CoreGui end
local getnilinstances = getnilinstances or function() return {} end
local fireclickdetector = fireclickdetector or function() end
local fireproximityprompt = fireproximityprompt or function() end
local getinstances = getinstances or function() return {game} end

-- UNC: Signals/Events
local firesignal = firesignal or function(signal)
    -- Fallback: try to fire via :Fire()
    local ok = pcall(function() signal:Fire() end)
    return ok
end
local getconnections = getconnections or function(instance)
    -- Fallback: use Roblox :GetConnections() if available
    local ok, conns = pcall(function() return instance:GetConnections() end)
    if ok then return conns end
    return {}
end

-- UNC: Reflection
local setthreadidentity = setthreadidentity or function() end
local getthreadidentity = getthreadidentity or function() return 1 end
local sethiddenproperty = sethiddenproperty or function() end
local gethiddenproperty = gethiddenproperty or function() return nil end
local setscriptable = setscriptable or function() end

-- UNC: Closures
local checkcaller = checkcaller or function() return true end
local hookfunction = hookfunction or function() end
local newcclosure = newcclosure or function(f) return f end
local clonefunction = clonefunction or function(f) return f end

-- UNC: Debug
local debug = debug or {}
local debug_getupvalues = debug.getupvalues or function() return {} end
local debug_getregistry = debug.getregistry or function() return {} end
local debug_getinfo = debug.info or function() return {} end
local debug_setupvalue = debug.setupvalue or function() end
local debug_getconstant = debug.getconstant or function() end
local debug_getconstants = debug.getconstants or function() return {} end
local debug_getproto = debug.getproto or function() end
local debug_getprotos = debug.getprotos or function() return {} end

-- UNC: Scripts
local getscriptbytecode = getscriptbytecode or function() error("getscriptbytecode not available") end
local getloadedmodules = getloadedmodules or function() return {} end
local getrunningscripts = getrunningscripts or function() return {} end
local getsenv = getsenv or function() return {} end
local getscriptclosure = getscriptclosure or function(s) return s end
local decompile = decompile or nil

-- UNC: Metatable
local getrawmetatable = getrawmetatable or getmetatable
local setrawmetatable = setrawmetatable or function() end
local setreadonly = setreadonly or function() end
local isreadonly = isreadonly or function() return false end
local getnamecallmethod = getnamecallmethod or function() return "" end

-- UNC: Drawing
local isrenderobj = isrenderobj or function() return false end
local cleardrawcache = cleardrawcache or function() end

-- UNC: Miscellaneous
local request = request or function() error("request not available") end
local identifyexecutor = identifyexecutor or function() return "Unknown", "0.0" end

-- UNC: Input
local isrbxactive = isrbxactive or function() return true end

-- UNC: Filesystem (for cache/temp)
local writefile = writefile or function() end
local readfile = readfile or function() return "" end
local isfile = isfile or function() return false end
local delfile = delfile or function() end

-- Generate a unique worker ID for this executor instance
local WORKER_ID = G.MCP_WORKER_ID or nil
if not WORKER_ID then
    local ok, guid = pcall(function() return HttpService:GenerateGuid(false) end)
    if ok then WORKER_ID = guid
    else WORKER_ID = tostring(tick()) .. tostring(math.random(1, 999999)) end
end

-- ================================================================
-- 3. BASE64 ENCODING
-- ================================================================
local b64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
local function base64_encode(data)
    return ((data:gsub('.', function(x)
        local r,b='',x:byte()
        for i=8,1,-1 do r=r..(b%2^i-b%2^(i-1)>0 and '1' or '0') end
        return r;
    end)..'0000'):gsub('%d%d%d?%d?%d?%d?', function(x)
        if #x < 6 then return '' end
        local c=0
        for i=1,6 do c=c+(x:sub(i,i)=='1' and 2^(6-i) or 0) end
        return b64:sub(c+1,c+1)
    end)..({'', '==', '='})[#data%3+1])
end

-- ================================================================
-- 4. DECOMPILATION CHAIN
-- ================================================================
local function CreateDecompileFunction(id, options)
    local Endpoint = options.Endpoint
    local EncodingCallback = options.EncodeBytecode or function(x) return x end
    local FailedCallback = options.FailedRequestCallback or function(r)
        return "-- Failed to decompile:\n--[[" .. tostring(r) .. "\n--]]"
    end
    return function(scriptPath)
        local ok, bc = pcall(getscriptbytecode, scriptPath)
        if not ok then return "-- Failed to get bytecode:\n--[[" .. tostring(bc) .. "\n--]]" end
        local ok2, res = pcall(request, {
            Url = Endpoint, Method = "POST",
            Body = EncodingCallback(bc),
            Headers = { ["Content-Type"] = "text/plain" },
        })
        if not ok2 or res.StatusCode ~= 200 then return FailedCallback(res, scriptPath) end
        return "-- Decompiled with " .. id .. "\n" .. string.gsub(res.Body, string.char(0x00CD), " ")
    end
end

local KonstantDecompile = CreateDecompileFunction("Konstant", {
    Endpoint = G.MCP_KONSTANT_URL or "http://api.plusgiant5.com/konstant/decompile",
})
local MedalDecompile = CreateDecompileFunction("Medal", {
    Endpoint = G.MCP_MEDAL_URL or "https://medal.upio.dev/decompile",
    EncodeBytecode = base64_encode,
    FailedRequestCallback = function(_, p) return KonstantDecompile(p) end,
})

local LuaExpertLastCall = 0
local function LuaExpertDecompile(scriptPath)
    local ok, bc = pcall(getscriptbytecode, scriptPath)
    if not ok then return "-- Failed bytecode:\n--[[" .. tostring(bc) .. "\n--]]" end
    local elapsed = os.clock() - LuaExpertLastCall
    if elapsed < 0.12 then task.wait(0.12 - elapsed) end
    local ok2, res = pcall(request, {
        Url = G.MCP_LUAEXPERT_URL or "https://api.lua.expert/decompile",
        Method = "POST",
        Headers = { ["Content-Type"] = "application/json" },
        Body = HttpService:JSONEncode({ script = base64_encode(bc) }),
    })
    LuaExpertLastCall = os.clock()
    if not ok2 or res.StatusCode ~= 200 then return MedalDecompile(scriptPath) end
    return "-- Decompiled with lua.expert\n" .. res.Body
end

if not decompile then decompile = LuaExpertDecompile end

-- ================================================================
-- 5. LUAENCODE PRETTY-PRINT
-- ================================================================
local LuaEncode = nil
local leOk, leRes = pcall(function()
    return loadstring(game:HttpGet("https://raw.githubusercontent.com/chadhyatt/LuaEncode/refs/heads/master/src/LuaEncode.lua"))()
end)
if leOk and leRes then LuaEncode = leRes end

-- ================================================================
-- 6. RATE LIMITER
-- ================================================================
local Ratelimiter = { __index = Ratelimiter }
function Ratelimiter.new(opts)
    local self = setmetatable({}, Ratelimiter)
    self.Burst = opts.Burst; self.PeriodicInterval = opts.PeriodicInterval
    self.MainCallback = opts.MainCallback; self.Bucket = {}; self.Queue = {}
    self.IsDestroyed = false; self:SetupManagerThread(); return self
end
function Ratelimiter:QueueOperation(...) if self.IsDestroyed then return end table.insert(self.Queue, table.pack(...)) end
function Ratelimiter:SetupManagerThread()
    if self.IsDestroyed then return end
    self.Bucket = {}; self.Queue = {}
    if self.ManagerThread then task.cancel(self.ManagerThread); self.ManagerThread = nil end
    if self.PeriodicThread then task.cancel(self.PeriodicThread); self.PeriodicThread = nil end
    self.ManagerThread = task.spawn(function()
        while not self.IsDestroyed do
            local now = tick()
            if #self.Bucket > 0 then
                local nb = {}
                for _, t in self.Bucket do if now - t < self.Burst.Time then table.insert(nb, t) end end
                self.Bucket = nb
            end
            while #self.Bucket < self.Burst.Max and #self.Queue > 0 do
                local td = table.remove(self.Queue, 1)
                if td then table.insert(self.Bucket, tick())
                    task.defer(function() if not self.IsDestroyed then self.MainCallback(table.unpack(td, 1, td.n)) end end)
                end
            end
            task.wait()
        end
    end)
    if not self.PeriodicInterval then return end
    self.PeriodicThread = task.spawn(function() while not self.IsDestroyed do self:QueueOperation() task.wait(self.PeriodicInterval) end end)
end
function Ratelimiter:Destroy() if self.IsDestroyed then return end self.IsDestroyed = true
    if self.ManagerThread then task.cancel(self.ManagerThread) end
    if self.PeriodicThread then task.cancel(self.PeriodicThread) end
    table.clear(self.Bucket); table.clear(self.Queue)
end

-- ================================================================
-- 7. REGISTRATION INFO
-- ================================================================
local function GetRegistrationInfo()
    local player = Players.LocalPlayer
    local placeName = "Unknown"
    pcall(function()
        local info = MarketplaceService:GetProductInfo(game.PlaceId)
        placeName = info and info.Name or "Unknown"
    end)
    return {
        type = "register",
        worker_id = WORKER_ID,
        username = player and player.Name or "Unknown",
        userId = player and player.UserId or 0,
        placeId = game.PlaceId,
        jobId = game.JobId,
        placeName = placeName,
    }
end

-- ================================================================
-- 8. HTTP HELPERS
-- ================================================================
local function httpPost(url, body)
    local json = HttpService:JSONEncode(body)
    local ok, res = pcall(function() return HttpService:PostAsync(url, json, Enum.ContentType.ApplicationJson, false) end)
    if not ok then return nil, res end
    local ok2, dec = pcall(function() return HttpService:JSONDecode(res) end)
    if not ok2 then return nil, "Decode error: " .. tostring(res) end
    return dec, nil
end

-- ================================================================
-- 9. WEBSOCKET TRANSPORT
-- ================================================================
local WS_CONNECTED = false; local WS_SOCKET = nil; local WS_BUFFER = {}; local WS_MESSAGE_HANDLER = nil

local function wsConnect()
    local connectFn = (typeof(WebSocket) == "table" and WebSocket.connect) or nil
    if not connectFn then return false, "No WebSocket" end
    local ok, socket = pcall(connectFn, MCP_WS_URL)
    if not ok or not socket then return false, "Connection failed" end
    WS_SOCKET = socket; WS_CONNECTED = true
    local regMsg = HttpService:JSONEncode(GetRegistrationInfo())
    local sent = pcall(function() socket:Send(regMsg) end)
    if not sent then WS_CONNECTED = false; WS_SOCKET = nil; return false, "Register failed" end
    WS_MESSAGE_HANDLER = socket.OnMessage:Connect(function(msg)
        local ok2, d = pcall(function() return HttpService:JSONDecode(msg) end)
        if ok2 and d then
            if d.type == "task" then table.insert(WS_BUFFER, d) end
        end
    end)
    return true, nil
end

local function wsPoll()
    if not WS_CONNECTED or not WS_SOCKET then return nil, "closed" end
    if #WS_BUFFER > 0 then
        local msg = table.remove(WS_BUFFER, 1)
        return { type = msg.tool, id = msg.id, args = msg.args or {}, timestamp = msg.timestamp }, nil
    end
    return nil, "empty"
end

local function wsSendResult(id, data, error)
    if not WS_CONNECTED or not WS_SOCKET then return false end
    local payload = HttpService:JSONEncode({ type = "result", id = id, data = data, error = error })
    return pcall(function() WS_SOCKET:Send(payload) end)
end

-- ================================================================
-- 10. TASK WAIT (with WebSocket poll)
-- ================================================================
local function waitForTask(timeout)
    local task1 = wsPoll()
    if task1 then return task1 end
    if WS_CONNECTED then
        task.wait(0.1); local task2 = wsPoll()
        if task2 then return task2 end
        return nil
    end
    local body = { timeout = timeout or POLL_TIMEOUT_MS }
    if WORKER_ID then body.worker_id = WORKER_ID end
    local res, err = httpPost(MCP_HTTP_URL .. "/req", body)
    if res and res.type and res.type ~= "__timeout__" then return res end
    return nil
end

local function sendResult(id, data, error)
    if WS_CONNECTED and wsSendResult(id, data, error) then return true end
    WS_CONNECTED = false
    httpPost(MCP_HTTP_URL .. "/res", { id = id, data = data, error = error })
    return true
end

-- ================================================================
-- 11. SERIALIZATION HELPERS
-- ================================================================
local MAX_DEPTH = 8; local VISITED = nil
local function serializeValue(value, depth)
    if depth == nil then depth = 0 end; if depth > MAX_DEPTH then return "<<max>>" end
    local t = typeof(value)
    if t == "string" or t == "number" or t == "boolean" then return value end
    if t == "nil" then return nil end
    if t == "Vector3" then return { x = value.X, y = value.Y, z = value.Z } end
    if t == "Vector2" then return { x = value.X, y = value.Y } end
    if t == "CFrame" then local x,y,z,qx,qy,qz,qw = value:GetComponents(); return { x=x, y=y, z=z, qx=qx, qy=qy, qz=qz, qw=qw } end
    if t == "Color3" then return { r = value.R, g = value.G, b = value.B } end
    if t == "BrickColor" then return value.Name end
    if t == "EnumItem" then return tostring(value) end
    if t == "table" then local r = {}; for k,v in pairs(value) do local ks = serializeValue(k, depth+1); if ks ~= nil then r[ks] = serializeValue(v, depth+1) end end return r end
    if t == "Instance" then
        if VISITED and VISITED[value] then return { Name = value.Name, ClassName = value.ClassName, Path = tostring(value), _cycle = true } end
        if not VISITED then VISITED = {} end; VISITED[value] = true
        return { Name = value.Name, ClassName = value.ClassName, Path = tostring(value) }
    end
    return tostring(value)
end
local function safeSerialize(v) VISITED = {}; local r = serializeValue(v, 0); VISITED = nil; return r end

-- ================================================================
-- 12. INSTANCE UTILITIES
-- ================================================================
local function resolvePath(pathStr)
    if typeof(pathStr) ~= "string" then return nil, "Path must be string" end
    pathStr = pathStr:match("^%s*(.-)%s*$"); if pathStr == "" then return nil, "Empty path" end
    local gsm = pathStr:match("^game%s*:%s*GetService%s*%(%s*\"([^\"]+)\"%s*%)")
    if gsm then local ok, s = pcall(function() return cloneref(game:GetService(gsm)) end); if ok then return s, nil end return nil, "Service not found" end
    gsm = pathStr:match("^game%s*:%s*GetService%s*%(%s*'([^']+)'%s*%)")
    if gsm then local ok, s = pcall(function() return cloneref(game:GetService(gsm)) end); if ok then return s, nil end return nil, "Service not found" end
    local clean = pathStr
    if clean:sub(1,5) == "game." then clean = clean:sub(6)
    elseif clean:sub(1,10) == "workspace." then clean = "Workspace." .. clean:sub(11)
    elseif clean:sub(1,8) == "players." then clean = "Players." .. clean:sub(9) end
    local parts = {}; for p in clean:gmatch("[^.\\/]+") do table.insert(parts, p) end
    if #parts == 0 then return game, nil end
    local obj
    if parts[1] == "game" then obj = game; table.remove(parts,1)
    elseif parts[1] == "Workspace" then obj = workspace; table.remove(parts,1)
    elseif parts[1] == "Players" then obj = Players; table.remove(parts,1)
    elseif parts[1] == "LocalPlayer" then obj = LocalPlayer; table.remove(parts,1)
    else obj = game end
    if #parts == 0 then return obj, nil end
    for _, name in ipairs(parts) do
        local child = obj:FindFirstChild(name)
        if not child then return nil, "Child not found: " .. name end
        obj = child
    end
    return obj, nil
end

local function getFullPath(inst)
    if not inst then return "nil" end
    if inst == game then return "game" end
    if inst == workspace then return "game.Workspace" end
    local p = {}; local o = inst
    while o and o ~= game do table.insert(p, 1, o.Name); o = o.Parent end
    return "game." .. table.concat(p, ".")
end

local function findDescendants(root, opts)
    opts = opts or {}
    local cf = opts.classFilter or ""; local np = opts.namePattern or ""
    local md = opts.maxDepth or -1; local mr = opts.maxResults or 0
    local r = {}
    local function walk(inst, depth)
        if mr > 0 and #r >= mr then return end; if md >= 0 and depth > md then return end
        if depth > 0 then
            local match = true
            if cf ~= "" then local cls = {}; for c in cf:gmatch("[^,]+") do local t = c:match("^%s*(.-)%s*$"); if t then cls[t] = true end end; if next(cls) and not cls[inst.ClassName] then match = false end end
            if match and np ~= "" then match = inst.Name:lower():find(np:lower()) ~= nil end
            if match then table.insert(r, { Name = inst.Name, ClassName = inst.ClassName, Path = getFullPath(inst) }) end
        end
        for _, child in ipairs(inst:GetChildren()) do walk(child, depth+1) end
    end
    walk(root, 0); return r
end

-- ================================================================
-- 13. GENERIC HANDLERS
-- ================================================================

-- 13a. handleTreeExplore
local function handleTreeExplore(args)
    local action = args.action or "walk"; local startPath = args.start_path or "game"
    local maxDepth = args.max_depth or 10; local classFilter = args.class_filter or ""
    local namePattern = args.name_pattern or ""; local maxResults = args.max_results or 200

    if action == "walk" then
        local root, err = resolvePath(startPath); if not root then return { success = false, error = err } end
        local results = findDescendants(root, { classFilter = classFilter, namePattern = namePattern, maxDepth = maxDepth, maxResults = maxResults })
        return { success = true, count = #results, instances = results }
    end
    if action == "services" then
        local filter = (args.filter or ""):lower(); local results = {}
        for _, child in ipairs(game:GetChildren()) do
            if child.ClassName:find("Service") or child.ClassName:find("Provider") then
                if filter == "" or child.Name:lower():find(filter) then table.insert(results, { Name = child.Name, ClassName = child.ClassName, Path = getFullPath(child) }) end
            end
        end; return { success = true, count = #results, services = results }
    end
    if action == "class_collect" then
        local cn = args.class_name or ""; if cn == "" then return { success = false, error = "class_name required" } end
        local root, err = resolvePath(args.scope or "game"); if not root then return { success = false, error = err } end
        local results = {}
        local function walk(inst) if maxResults > 0 and #results >= maxResults then return end; if inst.ClassName == cn then table.insert(results, { Name = inst.Name, ClassName = inst.ClassName, Path = getFullPath(inst) }) end; for _, c in ipairs(inst:GetChildren()) do walk(c) end end
        walk(root); return { success = true, count = #results, instances = results }
    end
    if action == "path_resolve" then
        local inst, err = resolvePath(args.path or ""); if not inst then return { success = false, error = err } end
        return { success = true, instance = { Name = inst.Name, ClassName = inst.ClassName, Path = getFullPath(inst) } }
    end
    if action == "siblings" then
        local inst, err = resolvePath(args.instance_path or ""); if not inst then return { success = false, error = err } end
        local parent = inst.Parent; if not parent then return { success = false, error = "No parent" } end
        local dir = args.direction or "all"; local includeSelf = args.include_self or false; local cfl = args.class_filter or ""
        local siblings = {}; local found = false
        for _, child in ipairs(parent:GetChildren()) do
            if child == inst then found = true end
            if dir == "before" and found then continue end; if dir == "after" and not found and child ~= inst then continue end
            if child ~= inst or includeSelf then if cfl == "" or child.ClassName == cfl then table.insert(siblings, { Name = child.Name, ClassName = child.ClassName }) end end
        end; return { success = true, count = #siblings, siblings = siblings }
    end
    if action == "attribute_seek" then
        local attrName = args.attribute_name or ""; local attrValue = args.attribute_value
        local root, err = resolvePath(args.scope or "game"); if not root then return { success = false, error = err } end
        local results = {}
        local function walk(inst) if maxResults > 0 and #results >= maxResults then return end; local ha, val = pcall(function() return inst:GetAttribute(attrName) end); if ha and val ~= nil and (attrValue == nil or val == attrValue) then table.insert(results, { Name = inst.Name, ClassName = inst.ClassName, Path = getFullPath(inst), attribute_value = safeSerialize(val) }) end; for _, c in ipairs(inst:GetChildren()) do walk(c) end end
        walk(root); return { success = true, count = #results, instances = results }
    end
    if action == "tag_collect" then
        local tn = args.tag_name or ""; if tn == "" then return { success = false, error = "tag_name required" } end
        local root, err = resolvePath(args.scope or "game"); if not root then return { success = false, error = err } end
        local ok, instances = pcall(function() return CollectionService:GetTagged(tn) end)
        if not ok then return { success = false, error = "CollectionService error" } end
        local tagged = {}; local c = 0
        for _, inst in ipairs(instances) do if maxResults > 0 and c >= maxResults then break end; if root:IsAncestorOf(inst) or inst == root then table.insert(tagged, { Name = inst.Name, ClassName = inst.ClassName, Path = getFullPath(inst) }); c = c+1 end end
        return { success = true, count = #tagged, instances = tagged }
    end
    if action == "children" then
        local inst, err = resolvePath(args.instance_path or startPath); if not inst then return { success = false, error = err } end
        local children = {}; for _, c in ipairs(inst:GetChildren()) do table.insert(children, { Name = c.Name, ClassName = c.ClassName }) end
        return { success = true, count = #children, children = children }
    end
    if action == "nil_realm" then
        local fc = args.filter_by_class or ""; local mi = args.max_instances or 200; local results = {}; local seen = {}
        local function scan(cont) if mi > 0 and #results >= mi then return end; for _, c in ipairs(cont:GetChildren()) do if mi > 0 and #results >= mi then return end; if not seen[c] then seen[c]=true; if fc == "" or c.ClassName == fc then table.insert(results, { Name = c.Name, ClassName = c.ClassName, Path = getFullPath(c) }) end; scan(c) end end end
        scan(game); return { success = true, count = #results, instances = results }
    end
    if action == "datamodel" then
        local children = {}; for _, c in ipairs(game:GetChildren()) do table.insert(children, { Name = c.Name, ClassName = c.ClassName }) end
        return { success = true, count = #children, services = children }
    end
    if action == "property_seek" then
        local pn = args.property_name or ""; local pv = args.property_value; if pn == "" then return { success = false, error = "property_name required" } end
        local root, err = resolvePath(args.scope or "game"); if not root then return { success = false, error = err } end
        local results = {}
        local function walk(inst) if maxResults > 0 and #results >= maxResults then return end; local ok, val = pcall(function() return inst[pn] end); if ok and val ~= nil and (pv == nil or tostring(val) == tostring(pv)) then table.insert(results, { Name = inst.Name, ClassName = inst.ClassName, Path = getFullPath(inst), value = safeSerialize(val) }) end; for _, c in ipairs(inst:GetChildren()) do walk(c) end end
        walk(root); return { success = true, count = #results, instances = results }
    end
    if action == "proximity" then
        local pos = args.position or { x = 0, y = 0, z = 0 }; local radius = args.radius or 50
        local root, err = resolvePath(args.scope or "game.Workspace"); if not root then return { success = false, error = err } end
        local results = {}
        local function walk(inst) if maxResults > 0 and #results >= maxResults then return end; local ok, cf = pcall(function() return inst:GetPivot() end); if ok then local dx=cf.Position.X-pos.x;local dy=cf.Position.Y-pos.y;local dz=cf.Position.Z-pos.z;local dist=math.sqrt(dx*dx+dy*dy+dz*dz); if dist <= radius then table.insert(results, { Name = inst.Name, ClassName = inst.ClassName, Path = getFullPath(inst), distance = dist }) end end; for _, c in ipairs(inst:GetChildren()) do walk(c) end end
        walk(root); return { success = true, count = #results, instances = results }
    end
    if action == "subtree" then
        local root, err = resolvePath(args.start_path or "game"); if not root then return { success = false, error = err } end
        local results = {}
        local function walk(inst, d) if maxDepth >= 0 and d > maxDepth then return end; local e = { Name = inst.Name, ClassName = inst.ClassName, children = {} }; for _, c in ipairs(inst:GetChildren()) do local s = walk(c, d+1); if s then table.insert(e.children, s) end end; if d > 0 or e.Name ~= "game" then return e end; results = e.children; return nil end
        walk(root, 0); return { success = true, tree = results }
    end
    return { success = false, error = "Unknown tree action: " .. tostring(action) }
end

-- 13b. handlePropertyRead
local function handlePropertyRead(args)
    local action = args.action or "bulk_read"; local instPath = args.instance_path or args.path or "game"
    if action == "bulk_read" then
        local inst, err = resolvePath(instPath); if not inst then return { success = false, error = err } end
        local pn = args.properties or { "Name", "ClassName" }; local result = { _path = getFullPath(inst), _className = inst.ClassName }
        for _, p in ipairs(pn) do local ok, v = pcall(function() return inst[p] end); if ok then result[p] = safeSerialize(v) end end
        return { success = true, data = result }
    end
    if action == "deep_dive" then
        local inst, err = resolvePath(instPath); if not inst then return { success = false, error = err } end
        local pn = args.property_name or ""; if pn == "" then return { success = false, error = "property_name required" } end
        local ok, v = pcall(function() return inst[pn] end); if not ok then return { success = false, error = "Cannot read " .. pn } end
        return { success = true, property = pn, value = safeSerialize(v), type = typeof(v) }
    end
    if action == "attributes" then
        local inst, err = resolvePath(instPath); if not inst then return { success = false, error = err } end
        local an = args.attribute_names or {}; local result = {}
        if #an > 0 then for _, n in ipairs(an) do local ok, v = pcall(function() return inst:GetAttribute(n) end); if ok then result[n] = safeSerialize(v) end end
        else local ok, attrs = pcall(function() return inst:GetAttributes() end); if ok then for k, v in pairs(attrs) do result[k] = safeSerialize(v) end end end
        return { success = true, attributes = result }
    end
    if action == "tags" then
        local inst, err = resolvePath(instPath); if not inst then return { success = false, error = err } end
        local tags = {}; local ok, tl = pcall(function() return CollectionService:GetTags(inst) end); if ok then for _, t in ipairs(tl) do table.insert(tags, t) end end
        return { success = true, tags = tags }
    end
    if action == "humanoid" then
        local inst, err = resolvePath(instPath); if not inst then return { success = false, error = err } end
        local hum = inst:FindFirstChildOfClass("Humanoid"); if not hum then return { success = false, error = "No Humanoid" } end
        local data = {}; local props = { "Health", "MaxHealth", "WalkSpeed", "JumpPower", "HipHeight", "AutoRotate", "FloorMaterial", "MoveDirection", "Sit", "StateType" }
        for _, p in ipairs(props) do local ok, v = pcall(function() return hum[p] end); if ok then data[p] = safeSerialize(v) end end
        return { success = true, humanoid = data }
    end
    if action == "value_container" then
        local inst, err = resolvePath(instPath); if not inst then return { success = false, error = err } end
        local values = {}; for _, c in ipairs(inst:GetChildren()) do if c.ClassName:find("Value") then local ok, v = pcall(function() return c.Value end); table.insert(values, { Name = c.Name, ClassName = c.ClassName, value = ok and safeSerialize(v) or nil }) end end
        return { success = true, count = #values, values = values }
    end
    if action == "player_state" then
        if not LocalPlayer then return { success = false, error = "No LocalPlayer" } end
        local data = {}; local char = LocalPlayer.Character; data.DisplayName = LocalPlayer.DisplayName; data.UserId = LocalPlayer.UserId; data.Name = LocalPlayer.Name
        if char then data.Character = { Name = char.Name, Path = getFullPath(char) }; local hum = char:FindFirstChildOfClass("Humanoid"); if hum then data.Health = hum.Health; data.MaxHealth = hum.MaxHealth; data.WalkSpeed = hum.WalkSpeed; data.JumpPower = hum.JumpPower end end
        return { success = true, player = data }
    end
    return { success = false, error = "Unknown action: " .. tostring(action) }
end

-- 13c. handleVisualOp
local function handleVisualOp(args)
    local action = args.action or "gui_dump"
    if action == "gui_dump" then
        local root = gethui(); local maxDepth = args.max_depth or 10; local results = {}
        local function walk(inst, depth) if depth > maxDepth then return end; local e = { Name = inst.Name, ClassName = inst.ClassName }; if inst.ClassName:find("Gui") or inst.ClassName:find("Button") or inst.ClassName:find("Label") or inst.ClassName:find("Box") then local props = { "Position", "Size", "Text", "TextColor3", "BackgroundColor3", "Image", "Visible" }; for _, p in ipairs(props) do local ok, v = pcall(function() return inst[p] end); if ok then e[p] = safeSerialize(v) end end end; e.children = {}; for _, c in ipairs(inst:GetChildren()) do table.insert(e.children, walk(c, depth+1)) end; return e end
        for _, c in ipairs(root:GetChildren()) do table.insert(results, walk(c, 0)) end
        return { success = true, guiTree = results }
    end
    if action == "text_extract" then
        local root = gethui(); local texts = {}
        local function walk(inst, depth) if depth > 10 then return end; local ht = pcall(function() return inst.Text end); if ht and inst.Text ~= "" then table.insert(texts, { Name = inst.Name, ClassName = inst.ClassName, Text = inst.Text, Path = getFullPath(inst) }) end; for _, c in ipairs(inst:GetChildren()) do walk(c, depth+1) end end
        walk(root, 0); return { success = true, count = #texts, texts = texts }
    end
    if action == "gui_inject" then
        local gt = args.gui_type or "ScreenGui"; local gn = args.gui_name or "McpOverlay"; local pp = args.parent_path or "game:GetService(\"CoreGui\")"
        local props = args.properties or {}; local parent, err = resolvePath(pp); if not parent then return { success = false, error = "Parent not found" } end
        local ok, ng = pcall(function() local inst = Instance.new(gt); inst.Name = gn; for k,v in pairs(props) do inst[k]=v end; inst.Parent = parent; return inst end)
        if not ok then return { success = false, error = "GUI create failed: " .. tostring(ng) } end
        return { success = true, name = gn, instance_path = getFullPath(ng) }
    end
    if action == "esp" then
        local state = args.state or "on"
        if state == "off" then local espFolder = CoreGui:FindFirstChild("McpESP"); if espFolder then espFolder:Destroy() end; return { success = true, message = "ESP disabled" } end
        return { success = true, message = "ESP state: " .. state }
    end
    if action == "camera" then
        local cam = workspace.CurrentCamera; return { success = true, camera = { CFrame = safeSerialize(cam.CFrame), Focus = safeSerialize(cam.Focus), FieldOfView = cam.FieldOfView, CameraType = tostring(cam.CameraType) } }
    end
    if action == "world_to_screen" then
        local cam = workspace.CurrentCamera; local pos = args.position or { x = 0, y = 0, z = 0 }
        local ok, sp, os_ = pcall(function() return cam:WorldToScreenPoint(Vector3.new(pos.x, pos.y, pos.z)) end)
        if not ok then return { success = false, error = "Conversion failed" } end
        return { success = true, screenPosition = { x = sp.X, y = sp.Y, z = sp.Z }, onScreen = os_ }
    end
    if action == "click_gui" then
        local path = args.path or ""; if path == "" then return { success = false, error = "path required" } end
        local inst, err = resolvePath(path); if not inst then return { success = false, error = err } end
        local signals = { "Activated", "MouseButton1Down", "MouseButton2Down", "MouseButton1Click", "MouseButton2Click" }
        for _, sName in ipairs(signals) do local ok = pcall(function() firesignal(inst[sName]) end) end
        return { success = true, message = "Fired click signals on: " .. path }
    end
    return { success = false, error = "Unknown visual action: " .. tostring(action) }
end

-- 13d. handleInputSim
local function handleInputSim(args)
    local action = args.action or "mouse_click"
    if action == "mouse_click" then
        local ct = args.click_type or "click"
        pcall(function() local m = LocalPlayer:GetMouse(); if ct == "click" or ct == "down" then m.Button1Down = true end; task.wait(0.05); if ct == "click" or ct == "up" then m.Button1Down = false end end)
        return { success = true, message = "Mouse " .. ct }
    end
    if action == "mouse_hold" then
        local dur = args.duration_seconds or 1
        pcall(function() local m = LocalPlayer:GetMouse(); m.Button1Down = true; task.wait(dur); m.Button1Down = false end)
        return { success = true, message = "Mouse held " .. tostring(dur) .. "s" }
    end
    if action == "key_press" then
        local key = args.key or ""; if key == "" then return { success = false, error = "key required" } end
        local vKey = Enum.KeyCode[key]; if not vKey then return { success = false, error = "Unknown key: " .. key } end
        pcall(function() VirtualInputManager:SendKeyEvent(true, vKey, false, game); task.wait(0.05); VirtualInputManager:SendKeyEvent(false, vKey, false, game) end)
        return { success = true, key = key }
    end
    if action == "type_text" then
        local text = args.text or ""; if text == "" then return { success = false, error = "text required" } end
        pcall(function() for i=1,#text do local char=text:sub(i,i); local kc=Enum.KeyCode[char:upper()]; if kc then VirtualInputManager:SendKeyEvent(true,kc,false,game); task.wait(0.03); VirtualInputManager:SendKeyEvent(false,kc,false,game); task.wait(0.03) end end end)
        return { success = true, message = "Typed " .. tostring(#text) .. " chars" }
    end
    if action == "key_combo" then
        local keys = args.keys or {}
        pcall(function() for _,kn in ipairs(keys) do local vk=Enum.KeyCode[kn]; if vk then VirtualInputManager:SendKeyEvent(true,vk,false,game) end end; task.wait(0.05); for i=#keys,1,-1 do local vk=Enum.KeyCode[keys[i]]; if vk then VirtualInputManager:SendKeyEvent(false,vk,false,game) end end end)
        return { success = true, message = "Key combo sent" }
    end
    if action == "char_move" then
        local t = args.target_position or { x = 0, y = 0, z = 0 }
        if not LocalPlayer.Character then return { success = false, error = "No character" } end
        local hrp = LocalPlayer.Character:FindFirstChild("HumanoidRootPart"); if not hrp then return { success = false, error = "No HRP" } end
        hrp.CFrame = CFrame.new(Vector3.new(t.x, t.y, t.z))
        return { success = true }
    end
    return { success = false, error = "Unknown input action: " .. tostring(action) }
end

-- 13e. handleStateBypass
local function handleStateBypass(args)
    local action = args.action or "noclip"
    if action == "noclip" then
        local state = args.state or true
        if not LocalPlayer.Character then return { success = false, error = "No character" } end
        for _, part in ipairs(LocalPlayer.Character:GetDescendants()) do if part:IsA("BasePart") then part.CanCollide = not state end end
        return { success = true, message = state and "Noclip on" or "Noclip off" }
    end
    if action == "speed" then
        local speed = args.walk_speed or 50; local dur = args.duration_seconds or 0
        if not LocalPlayer.Character then return { success = false, error = "No character" } end
        local hum = LocalPlayer.Character:FindFirstChildOfClass("Humanoid"); if not hum then return { success = false, error = "No Humanoid" } end
        local orig = hum.WalkSpeed; hum.WalkSpeed = speed
        if dur > 0 then task.delay(dur, function() if hum then hum.WalkSpeed = orig end end) end
        return { success = true, message = "WalkSpeed set to " .. tostring(speed) }
    end
    if action == "jump" then
        local jp = args.jump_power or 100; if not LocalPlayer.Character then return { success = false, error = "No character" } end
        local hum = LocalPlayer.Character:FindFirstChildOfClass("Humanoid"); if not hum then return { success = false, error = "No Humanoid" } end; hum.JumpPower = jp
        return { success = true, message = "JumpPower set to " .. tostring(jp) }
    end
    if action == "health" then
        local mode = args.mode or "heal_to_full"
        if not LocalPlayer.Character then return { success = false, error = "No character" } end
        local hum = LocalPlayer.Character:FindFirstChildOfClass("Humanoid"); if not hum then return { success = false, error = "No Humanoid" } end
        if mode == "heal_to_full" then hum.Health = hum.MaxHealth; return { success = true, message = "Healed" } end
        if mode == "god_mode" then hum.HealthChanged:Connect(function(h) if h<=0 then hum.Health = hum.MaxHealth end end); return { success = true, message = "God mode" } end
        if mode == "set_health" then hum.Health = args.health_value or hum.MaxHealth; return { success = true, message = "Health set" } end
        return { success = false, error = "Unknown mode" }
    end
    if action == "stun" then
        if not LocalPlayer.Character then return { success = false, error = "No character" } end
        local hum = LocalPlayer.Character:FindFirstChildOfClass("Humanoid"); if not hum then return { success = false, error = "No Humanoid" } end
        pcall(function() hum.PlatformStand = false; hum.AutoRotate = true end)
        return { success = true, message = "Stun cleared" }
    end
    if action == "ragdoll" then
        if not LocalPlayer.Character then return { success = false, error = "No character" } end
        local hum = LocalPlayer.Character:FindFirstChildOfClass("Humanoid"); if not hum then return { success = false, error = "No Humanoid" } end
        pcall(function() hum:ChangeState(Enum.HumanoidStateType.GettingUp); hum.PlatformStand = false end)
        return { success = true, message = "Ragdoll cancelled" }
    end
    if action == "teleport" then
        local tt = args.target_type or "coordinates"
        if not LocalPlayer.Character then return { success = false, error = "No character" } end
        local hrp = LocalPlayer.Character:FindFirstChild("HumanoidRootPart"); if not hrp then return { success = false, error = "No HRP" } end
        if tt == "coordinates" then
            local c = args.coordinates or { x=0, y=0, z=0 }; hrp.CFrame = CFrame.new(Vector3.new(c.x, c.y, c.z)); return { success = true, position = c }
        end
        if tt == "player" then
            local tn = args.target_player_name or ""; local target = Players:FindFirstChild(tn)
            if not target then return { success = false, error = "Player not found" } end
            if not target.Character then return { success = false, error = "Target no character" } end
            local thrp = target.Character:FindFirstChild("HumanoidRootPart"); if not thrp then return { success = false, error = "Target no HRP" } end
            hrp.CFrame = thrp.CFrame + Vector3.new(0, 3, 0); return { success = true, target = tn }
        end
        return { success = false, error = "Unknown teleport type" }
    end
    if action == "cooldown" then
        if not LocalPlayer.Character then return { success = false, error = "No character" } end
        local tool = LocalPlayer.Character:FindFirstChildOfClass("Tool")
        if tool then for _, c in ipairs(tool:GetDescendants()) do if c:IsA("NumberValue") and (c.Name:lower():find("cooldown") or c.Name:lower():find("cd")) then c.Value=0 end; if c:IsA("BoolValue") and (c.Name:lower():find("debounce") or c.Name:lower():find("cooldown")) then c.Value=false end end end
        return { success = true, message = "Cooldowns reset attempted" }
    end
    if action == "currency" then
        local val = args.value or 9999; local p = args.stat_path or ""
        if p ~= "" then local inst, err = resolvePath(p); if inst then pcall(function() inst.Value = val end) end
        else local ls = LocalPlayer:FindFirstChild("leaderstats"); if ls then for _,c in ipairs(ls:GetChildren()) do if c:IsA("NumberValue") or c:IsA("IntValue") then pcall(function() c.Value=val end) end end end end
        return { success = true, message = "Currency mod attempted" }
    end
    if action == "animation" then
        if not LocalPlayer.Character then return { success = false, error = "No character" } end
        local hum = LocalPlayer.Character:FindFirstChildOfClass("Humanoid"); if not hum then return { success = false, error = "No Humanoid" } end
        pcall(function() hum:CrossFade(0); local anim = hum:FindFirstChildOfClass("Animator"); if anim then anim:StopAllTracks() end end)
        return { success = true, message = "Animation cancelled" }
    end
    return { success = false, error = "Unknown bypass action: " .. tostring(action) }
end

-- 13f. handleRemoteOp (UNC: getconnections)
local function handleRemoteOp(args)
    local action = args.action or "scan"; local remotePath = args.remote_path or ""
    if action == "scan" then
        local sp = args.search_paths or { "game:GetService(\"ReplicatedStorage\")", "game:GetService(\"Workspace\")", "game:GetService(\"ServerScriptService\")", "game:GetService(\"ServerStorage\")" }
        local remotes = {}
        for _, path in ipairs(sp) do
            local root, err = resolvePath(path); if root then
                local function find(inst) if inst:IsA("RemoteEvent") or inst:IsA("RemoteFunction") or inst:IsA("UnreliableRemoteEvent") then table.insert(remotes, { Name = inst.Name, ClassName = inst.ClassName, Path = getFullPath(inst) }) end; for _, c in ipairs(inst:GetChildren()) do find(c) end end
                find(root)
            end
        end
        return { success = true, count = #remotes, remotes = remotes }
    end
    if action == "fire" then
        if remotePath == "" then return { success = false, error = "remote_path required" } end
        local inst, err = resolvePath(remotePath); if not inst then return { success = false, error = err } end
        local fa = args.args or {}; local method = args.method or "FireServer"
        local ok, r = pcall(function() if method == "FireServer" then inst:FireServer(unpack(fa)); return { fired = true } else return inst:InvokeServer(unpack(fa)) end end)
        if not ok then return { success = false, error = "Failed: " .. tostring(r) } end
        return { success = true, result = safeSerialize(r) }
    end
    if action == "connections" then
        if remotePath == "" then return { success = false, error = "remote_path required" } end
        local inst, err = resolvePath(remotePath); if not inst then return { success = false, error = err } end
        local conns = getconnections(inst); local results = {}
        for _, c in ipairs(conns) do table.insert(results, { connected = c.Connected, enabled = c.Enabled, functionInfo = tostring(c.Function) }) end
        return { success = true, count = #results, connections = results }
    end
    if action == "ownership" then
        local scope, err = resolvePath(args.scope or "game:GetService(\"Workspace\")"); if not scope then return { success = false, error = err } end
        local results = {}
        for _, part in ipairs(scope:GetDescendants()) do
            if part:IsA("BasePart") then local owned = false; local ok, owner = pcall(function() return part:GetNetworkOwner() end); if ok and owner then owned = true end; table.insert(results, { Name = part.Name, Path = getFullPath(part), clientOwned = owned, owner = owned and tostring(owner) or "server" }) end
        end
        return { success = true, count = #results, parts = results }
    end
    if action == "clickdetector" then
        local target = args.target_path or ""; if target == "" then return { success = false, error = "target_path required" } end
        local inst, err = resolvePath(target); if not inst then return { success = false, error = err } end
        local cd = inst:FindFirstChildOfClass("ClickDetector"); if not cd then return { success = false, error = "No ClickDetector found" } end
        fireclickdetector(cd); return { success = true, message = "Fired ClickDetector" }
    end
    if action == "proximity_prompt" then
        local target = args.target_path or ""; if target == "" then return { success = false, error = "target_path required" } end
        local inst, err = resolvePath(target); if not inst then return { success = false, error = err } end
        local pp = inst:FindFirstChildOfClass("ProximityPrompt"); if not pp then return { success = false, error = "No ProximityPrompt" } end
        fireproximityprompt(pp); return { success = true, message = "Fired ProximityPrompt" }
    end
    return { success = false, error = "Unknown remote action: " .. tostring(action) }
end

-- 13g. handleTrafficSpy
local function handleTrafficSpy(args)
    local action = args.action or "install"
    if action == "install" then
        if not G.__mcpSpy then G.__mcpSpy = { active = true, log = {}, max = args.max_log_entries or 500 } end
        G.__mcpSpy.active = true; return { success = true, message = "Traffic interceptor installed" }
    end
    if action == "remove" then if G.__mcpSpy then G.__mcpSpy.active = false end; return { success = true, message = "Interceptor removed" } end
    if action == "status" then local lc=0; if G.__mcpSpy and G.__mcpSpy.log then lc=#G.__mcpSpy.log end; return { success=true, active=G.__mcpSpy and G.__mcpSpy.active or false, capturedEntries=lc } end
    if action == "block" then local rp=args.remote_path or ""; if not G.__mcpBlocked then G.__mcpBlocked={} end; G.__mcpBlocked[rp]=true; return { success=true, message="Blocking: "..rp } end
    if action == "killswitch" then local state=args.state or true; if not G.__mcpBlocked then G.__mcpBlocked={} end; G.__mcpBlocked.__ALL__=state; return { success=true, message=state and "All blocked" or "Killswitch off" } end
    return { success=false, error="Unknown traffic action: "..tostring(action) }
end

-- 13h. handleMemoryOp (UNC: debug_*)
local function handleMemoryOp(args)
    local action = args.action or "source_rip"
    if action == "source_rip" then
        local tp = args.target_path or ""; if tp == "" then return { success=false, error="target_path required" } end
        local inst, err = resolvePath(tp); if not inst then return { success=false, error=err } end
        local src = ""; local ok, s = pcall(function() return inst.Source end); if ok then src = s end
        if src == "" then ok, s = pcall(function() return inst.LinkedSource end); if ok then src = s end end
        return { success=true, source=src, className=inst.ClassName }
    end
    if action == "decompile" then
        local tp = args.target_path or ""; if tp == "" then return { success=false, error="target_path required" } end
        local inst, err = resolvePath(tp); if not inst then return { success=false, error=err } end
        local result = decompile(inst); return { success=true, source=result, className=inst.ClassName }
    end
    if action == "meta_inspect" then
        local tp = args.target_path or ""; if tp == "" then return { success=false, error="target_path required" } end
        local inst, err = resolvePath(tp); if not inst then return { success=false, error=err } end
        local mt = getrawmetatable(inst); return { success=true, hasMetatable=mt~=nil, metatable=safeSerialize(mt) }
    end
    if action == "module_scan" then
        local fn = args.filter_by_name or ""; local mm = args.max_modules or 50; local modules = {}
        local ok, reg = pcall(debug_getregistry) if ok and reg then for _, v in ipairs(reg) do if typeof(v)=="table" and v.Name then local mn=tostring(v.Name); if fn=="" or mn:lower():find(fn:lower()) then table.insert(modules, {name=mn, type=typeof(v)}); if mm>0 and #modules>=mm then break end end end end end
        return { success=true, count=#modules, modules=modules }
    end
    if action == "closure_inspect" then
        local tp = args.target_path or ""; if tp == "" then return { success=false, error="target_path required" } end
        local inst, err = resolvePath(tp); if not inst then return { success=false, error=err } end
        local info = { path=getFullPath(inst), className=inst.ClassName }
        local ok, nu = pcall(debug_getinfo, inst, "n"); if ok then info.upvalueCount = nu end
        return { success=true, data=info }
    end
    if action == "sandbox_detect" then return { success=true, checks={
        hasDebug = pcall(function() return debug_getregistry end),
        hasClosures = pcall(function() return debug_getupvalues end),
        executor = { identifyexecutor() },
    } } end
    if action=="code_exec" then local code=args.code or ""; if code=="" then return {success=false, error="code required"} end; local ok,fn=pcall(loadstring, code); if not ok then return {success=false, error="Compile error: "..tostring(fn)} end; local ok2,r=pcall(fn); if not ok2 then return {success=false, error="Runtime error: "..tostring(r)} end; return {success=true, result=safeSerialize(r)} end
    return { success=false, error="Unknown memory action: "..tostring(action) }
end

-- 13i. handleCodeExec
local function handleCodeExec(args)
    setthreadidentity(8)
    local code = args.code or ""; if code == "" then return { success = false, error = "code required" } end
    local ok, fn = pcall(loadstring, code); if not ok then return { success = false, error = "Compile error: " .. tostring(fn) } end
    local ok2, r = pcall(fn); if not ok2 then return { success = false, error = "Runtime error: " .. tostring(r) } end
    return { success = true, result = safeSerialize(r) }
end

-- 13j. handleConsoleLog
local function handleConsoleLog(args)
    local lt = args.log_type or "all"; local ml = args.max_lines or 100; local it = args.include_timestamp or true
    local entries = {}; local logs = LogService:GetLogHistory(); local count = 0
    for i = #logs, 1, -1 do if count >= ml then break end; local e = logs[i]; local mt = tostring(e.messageType):lower(); if lt == "all" or mt:find(lt) then local entry = { message = e.message, type = mt }; if it then entry.timestamp = e.timestamp or tick() end; table.insert(entries, 1, entry); count = count + 1 end end
    return { success = true, count = #entries, entries = entries }
end

-- 13k. handleGetMetadata
local function handleGetMetadata(args)
    local ip = args.include_performance or true
    local data = { PlaceId = game.PlaceId, GameId = game.GameId, JobId = game.JobId, CreatorId = game.CreatorId, CreatorType = tostring(game.CreatorType), Name = game.Name, Description = game.Description, PlayerCount = #Players:GetPlayers(), MaxPlayers = Players.MaxPlayers, ServerTime = tick() }
    if ip then data.FPS = 1 / (RunService.Heartbeat:Wait() or 0.016); data.Memory = collectgarbage("count") end
    return { success = true, metadata = data }
end

-- 13l. handleHiddenProperty (UNC: sethiddenproperty / gethiddenproperty)
local function handleHiddenProperty(args)
    local action = args.action or "get"; local path = args.instance_path or ""; local prop = args.property or ""
    if prop == "" then return { success = false, error = "property required" } end
    local inst, err = resolvePath(path); if not inst then return { success = false, error = err } end
    if action == "get" then
        local ok, val = pcall(gethiddenproperty, inst, prop); if not ok then return { success = false, error = "Cannot read hidden property" } end
        return { success = true, property = prop, value = safeSerialize(val) }
    end
    if action == "set" then
        local val = args.value; local ok = pcall(sethiddenproperty, inst, prop, val)
        if not ok then return { success = false, error = "Cannot set hidden property" } end
        return { success = true, property = prop }
    end
    if action == "make_scriptable" then
        pcall(setscriptable, inst, prop, true)
        return { success = true, message = prop .. " is now scriptable" }
    end
    return { success = false, error = "Unknown action" }
end

-- ================================================================
-- 14. ROUTER TABLE
-- ================================================================
-- ================================================================
-- 13m. handleClosureOp — Function hooking & closure inspection
-- ================================================================
local function handleClosureOp(args)
    local action = args.action or "check_type"
    if action == "check_type" then
        local fp = args.function_path or ""; if fp == "" then return { success = false, error = "function_path required" } end
        local fn = nil; local ok, r = pcall(function() return loadstring("return " .. fp)() end); if ok then fn = r end
        if not fn and fp ~= "" then local inst, err = resolvePath(fp); if inst then fn = inst end end
        if type(fn) ~= "function" then return { success = false, error = "Not a function" } end
        return { success = true, isCClosure = pcall(iscclosure, fn) and iscclosure(fn) or false, isLClosure = pcall(islclosure, fn) and islclosure(fn) or false, isExecutor = pcall(isexecutorclosure, fn) and isexecutorclosure(fn) or false, isCaller = pcall(checkcaller) and checkcaller() or false }
    end
    if action == "hook" then
        local t = args.target or ""; local hc = args.hook_code or ""; local m = args.method_name or ""
        if t == "" or hc == "" then return { success = false, error = "target and hook_code required" } end
        local ok, hf = pcall(loadstring, "return function(orig, ...) " .. hc .. " end"); if not ok then return { success = false, error = "Hook: " .. tostring(hf) } end
        if m ~= "" then local inst, err = resolvePath(t); if not inst then return { success = false, error = err } end; local tf = inst[m]; if not tf then return { success = false, error = "Method not found" } end; pcall(hookfunction, tf, hf()); return { success = true, hooked = t .. "." .. m }
        else local ok3, tf2 = pcall(function() return loadstring("return " .. t)() end); if not ok3 or type(tf2) ~= "function" then return { success = false, error = "Not a function" } end; pcall(hookfunction, tf2, hf()); return { success = true, hooked = t } end
    end
end

-- 13n. handleEnvOp — Environment exploration
local function handleEnvOp(args)
    local action = args.action or "gc_scan"
    if action == "gc_scan" then
        local ft = args.filter_type or "all"; local np = args.name_pattern or ""; local mr = args.max_results or 50
        local ok, gc = pcall(getgc); if not ok then return { success = false, error = "getgc not available" } end
        local r = {}; for _, v in ipairs(gc) do if mr>0 and #r>=mr then break end; if ft~="all" and type(v)~=ft then continue end; if np~="" and not tostring(v):lower():find(np:lower()) then continue end; table.insert(r, {type=type(v), value=safeSerialize(v)}) end
        return { success = true, count = #r, objects = r }
    end
    if action == "env_view" then
        local ns = args.namespace or "both"; local result = {}
        if ns=="renv" or ns=="both" then local ok, renv = pcall(getrenv); if ok then local c=0; for k,v in pairs(renv) do if c>=50 then break end; result[tostring(k)]=type(v); c=c+1 end end end
        if ns=="genv" or ns=="both" then local genv = getgenv(); if genv then local c=0; for k,v in pairs(genv) do if c>=50 then break end; result["exec_"..tostring(k)]=type(v); c=c+1 end end end
        return { success = true, environment = result }
    end
    if action == "script_env" then
        local sp = args.script_path or ""; if sp == "" then return { success = false, error = "script_path required" } end
        local inst, err = resolvePath(sp); if not inst then return { success = false, error = err } end
        local ok, env = pcall(getsenv, inst); if not ok then return { success = false, error = "getsenv not available" } end
        local mv = args.max_values or 50; local result = {}; local c=0
        for k,v in pairs(env) do if c>=mv then break end; result[tostring(k)]=type(v); c=c+1 end
        return { success = true, script = sp, variables = result }
    end
    if action == "registry" then
        local kf = args.key_filter or ""; local me = args.max_entries or 100
        local ok, reg = pcall(getreg); if not ok then return { success = false, error = "getreg not available" } end
        local result = {}; local c=0
        for i, v in ipairs(reg) do if me>0 and c>=me then break end; if kf=="" or tostring(i):find(kf) then result[tostring(i)]=type(v); c=c+1 end end
        return { success = true, entries = result }
    end
end

-- 13o. handleFileOp — Filesystem operations
local function handleFileOp(args)
    local action = args.action or "read"
    if action == "read" then local p=args.path or ""; if p=="" then return {success=false, error="path required"} end; local ok, c = pcall(readfile, p); if not ok then return {success=false, error="readfile failed"} end; return {success=true, path=p, content=c, size=#c} end
    if action == "write" then local p=args.path or ""; local c=args.content or ""; if p=="" then return {success=false, error="path required"} end; pcall(writefile, p, c); return {success=true, path=p, bytes=#c} end
    if action == "delete" then local p=args.path or ""; if p=="" then return {success=false, error="path required"} end; local ok=pcall(delfile, p); if not ok then pcall(delfolder, p) end; return {success=true, deleted=p} end
    if action == "list" then local p=args.path or ""; local ok, files=pcall(listfiles, p); if not ok then return {success=false, error="listfiles failed"} end; local r={}; for _,f in ipairs(files) do table.insert(r, {name=f, isFile=pcall(isfile, f) and isfile(f) or false}) end; return {success=true, count=#r, files=r} end
    if action == "mkdir" then local p=args.path or ""; if p=="" then return {success=false, error="path required"} end; pcall(makefolder, p); return {success=true, created=p} end
    if action == "load_asset" then local fp=args.file_path or ""; if fp=="" then return {success=false, error="file_path required"} end; local ok, url=pcall(getcustomasset, fp); if not ok then return {success=false, error="getcustomasset failed"} end; return {success=true, assetUrl=url, file=fp} end
end

-- 13p. handleScriptOp — Script introspection
local function handleScriptOp(args)
    local action = args.action or "list_running"
    if action == "list_running" then
        local fc = args.filter_by_class or ""; local ms = args.max_scripts or 100
        local ok, scripts = pcall(getrunningscripts); if not ok then return { success = false, error = "getrunningscripts not available" } end
        local r = {}; for _, s in ipairs(scripts) do if ms>0 and #r>=ms then break end; if fc=="" or s.ClassName==fc then table.insert(r, {Name=s.Name, ClassName=s.ClassName, Path=getFullPath(s)}) end end
        return { success = true, count = #r, scripts = r }
    end
    if action == "get_calling" then
        local ok, script = pcall(getcallingscript); if not ok then return { success = false, error = "getcallingscript not available" } end
        if not script then return { success = true, callingScript = nil, message = "No calling script (main thread)" } end
        return { success = true, callingScript = { Name = script.Name, ClassName = script.ClassName, Path = getFullPath(script) } }
    end
    if action == "get_closure" then
        local sp = args.script_path or ""; if sp == "" then return { success = false, error = "script_path required" } end
        local inst, err = resolvePath(sp); if not inst then return { success = false, error = err } end
        local ok, closure = pcall(getscriptclosure, inst); if not ok then return { success = false, error = "getscriptclosure failed" } end
        local info = { path = getFullPath(inst), className = inst.ClassName, hasClosure = closure ~= nil }
        if args.include_debug_info then local ok2, nu = pcall(debug_getinfo, closure, "n"); if ok2 then info.upvalueCount = nu end end
        return { success = true, scriptInfo = info }
    end
    if action == "hash" then
        local sp = args.script_path or ""; if sp == "" then return { success = false, error = "script_path required" } end
        local inst, err = resolvePath(sp); if not inst then return { success = false, error = err } end
        local ok, hash = pcall(getscripthash, inst); if not ok then return { success = false, error = "getscripthash not available" } end
        return { success = true, script = sp, hash = hash }
    end
end

-- 13q. handleMetaOp — Metatable manipulation
local function handleMetaOp(args)
    local action = args.action or "readonly"
    if action == "set_raw" then
        local tp = args.target_path or ""; local mc = args.metatable_code or ""
        if tp == "" or mc == "" then return { success = false, error = "target_path and metatable_code required" } end
        local inst, err = resolvePath(tp); if not inst then return { success = false, error = err } end
        local ok, mt = pcall(loadstring, "return " .. mc); if not ok then return { success = false, error = "Metatable error: " .. tostring(mt) } end
        pcall(setrawmetatable, inst, mt); return { success = true, message = "Raw metatable set" }
    end
    if action == "readonly" then
        local tp = args.target_path or ""; if tp == "" then return { success = false, error = "target_path required" } end
        local tbl = nil; local ok = pcall(function() tbl = loadstring("return " .. tp)() end)
        if not ok or type(tbl) ~= "table" then return { success = false, error = "Not a table" } end
        if args.state ~= nil then local was = pcall(isreadonly, tbl); pcall(setreadonly, tbl, args.state); return { success = true, wasReadonly = was, nowReadonly = args.state } end
        return { success = true, isReadonly = pcall(isreadonly, tbl) }
    end
    if action == "namecall_spy" then
        local tp = args.target_path or ""; if tp == "" then return { success = false, error = "target_path required" } end
        local inst, err = resolvePath(tp); if not inst then return { success = false, error = err } end
        local mt = getrawmetatable(inst) or {}; pcall(setrawmetatable, inst, mt)
        local calls = {}; local mc = args.max_calls or 50; local mf = args.method_filter or ""
        local oldNC = mt.__namecall; if type(oldNC) ~= "function" then oldNC = nil end
        mt.__namecall = newcclosure(function(...)
            local method = getnamecallmethod()
            if mf == "" or method:lower() == mf:lower() then if #calls < mc then table.insert(calls, { method = method, time = tick() }) end end
            if oldNC then return oldNC(...) else return nil end
        end)
        return { success = true, monitoring = true, maxCalls = mc, filter = mf }
    end
end

-- 13r. handleSignalOp — Signal utilities
local function handleSignalOp(args)
    local action = args.action or "compare"
    if action == "compare" then
        local pa = args.path_a or ""; local pb = args.path_b or ""
        if pa == "" or pb == "" then return { success = false, error = "path_a and path_b required" } end
        local ia, ea = resolvePath(pa); if not ia then return { success = false, error = ea } end
        local ib, eb = resolvePath(pb); if not ib then return { success = false, error = eb } end
        local equal = false; pcall(function() equal = compareinstances(ia, ib) end)
        return { success = true, instanceA = getFullPath(ia), instanceB = getFullPath(ib), sameInstance = equal, sameName = ia.Name == ib.Name, sameClass = ia.ClassName == ib.ClassName }
    end
    if action == "replicate" then
        local rp = args.remote_path or ""; if rp == "" then return { success = false, error = "remote_path required" } end
        local inst, err = resolvePath(rp); if not inst then return { success = false, error = err } end
        local fa = args.args or {}; local ok = pcall(replicatesignal, inst, unpack(fa)); if not ok then return { success = false, error = "replicatesignal failed" } end
        return { success = true, message = "Signal replicated" }
    end
end

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
    security_metadata_analyzer = { handler = handlePropertyRead, config = { action = "bulk_read" } },
    attribute_collector = { handler = handlePropertyRead, config = { action = "attributes" } },
    tag_reader = { handler = handlePropertyRead, config = { action = "tags" } },
    humanoid_state_extractor = { handler = handlePropertyRead, config = { action = "humanoid" } },
    value_container_scanner = { handler = handlePropertyRead, config = { action = "value_container" } },
    object_value_resolver = { handler = handlePropertyRead, config = { action = "value_container" } },
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
    gui_button_clicker = { handler = handleVisualOp, config = { action = "click_gui" } },

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
    script_decompiler = { handler = handleMemoryOp, config = { action = "decompile" } },
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
    fire_click_detector = { handler = handleRemoteOp, config = { action = "clickdetector" } },
    fire_proximity_prompt = { handler = handleRemoteOp, config = { action = "proximity_prompt" } },

    -- Hidden Property Tools (UNC: sethiddenproperty)
    hidden_property_reader = { handler = handleHiddenProperty, config = { action = "get" } },
    hidden_property_writer = { handler = handleHiddenProperty, config = { action = "set" } },
    property_scriptable_toggler = { handler = handleHiddenProperty, config = { action = "make_scriptable" } },

    -- State Bypass
    teleport_to_target = { handler = handleStateBypass, config = { action = "teleport" } },
    interact_all_proximity_prompts = { handler = handleTreeExplore, config = { action = "proximity" } },

    -- Closure & Function Hooking
    function_hook_installer = { handler = handleClosureOp, config = { action = "hook" } },
    closure_type_checker = { handler = handleClosureOp, config = { action = "check_type" } },

    -- Environment Exploration
    gc_scanner = { handler = handleEnvOp, config = { action = "gc_scan" } },
    registry_reader = { handler = handleEnvOp, config = { action = "registry" } },
    roblox_environment_viewer = { handler = handleEnvOp, config = { action = "env_view" } },
    script_environment_dumper = { handler = handleEnvOp, config = { action = "script_env" } },

    -- Filesystem Operations
    file_reader = { handler = handleFileOp, config = { action = "read" } },
    file_writer = { handler = handleFileOp, config = { action = "write" } },
    file_deleter = { handler = handleFileOp, config = { action = "delete" } },
    file_lister = { handler = handleFileOp, config = { action = "list" } },
    folder_creator = { handler = handleFileOp, config = { action = "mkdir" } },
    custom_asset_loader = { handler = handleFileOp, config = { action = "load_asset" } },

    -- Script Introspection
    running_scripts_lister = { handler = handleScriptOp, config = { action = "list_running" } },
    calling_script_finder = { handler = handleScriptOp, config = { action = "get_calling" } },
    script_closure_getter = { handler = handleScriptOp, config = { action = "get_closure" } },
    script_hash_calculator = { handler = handleScriptOp, config = { action = "hash" } },

    -- Metatable & Memory Manipulation
    raw_metatable_setter = { handler = handleMetaOp, config = { action = "set_raw" } },
    readonly_toggler = { handler = handleMetaOp, config = { action = "readonly" } },
    namecall_spy = { handler = handleMetaOp, config = { action = "namecall_spy" } },

    -- Instance & Signal Utilities
    instance_comparer = { handler = handleSignalOp, config = { action = "compare" } },
    signal_replicator = { handler = handleSignalOp, config = { action = "replicate" } },
}

-- ================================================================
-- 15. MAIN POLLING LOOP
-- ================================================================
local function pollLoop()
    -- Try WebSocket first
    if TRANSPORT ~= "http" then
        local wsOk, wsErr = wsConnect()
        if wsOk then print("[MCP] WebSocket: " .. MCP_WS_URL)
        else warn("[MCP] WS failed: " .. tostring(wsErr) .. " — falling back to HTTP polling") end
    end

    while true do
        local ok, pollResult = pcall(waitForTask, POLL_TIMEOUT_MS)
        if not ok then warn("[MCP] Poll error: " .. tostring(pollResult)); task.wait(1); continue end
        if not pollResult then task.wait(0.5); continue end

        local toolName = pollResult.type; local taskId = pollResult.id; local taskArgs = pollResult.args or {}
        local entry = ROUTER[toolName]; local resultData

        if not entry then
            resultData = { success = false, error = "Unknown tool: " .. toolName }
        else
            local config = entry.config or {}
            local merged = {}
            for k,v in pairs(config) do if type(k)=="string" and not k:match("^_") then merged[k]=v end end
            for k,v in pairs(taskArgs) do merged[k]=v end
            if config.action and not merged.action then merged.action=config.action end
            local handlerOk, handlerResult = pcall(entry.handler, merged)
            if handlerOk then resultData = handlerResult else resultData = { success = false, error = "Handler: " .. tostring(handlerResult) } end
        end

        local sendOk, sendErr = pcall(sendResult, taskId, resultData, nil)
        if not sendOk then warn("[MCP] Send fail: " .. tostring(sendErr)) end
    end
end

-- ================================================================
-- 16. EXECUTION
-- ================================================================
local mainOk, mainErr = pcall(function()
    print("[MCP] Client v1.0.0 | Server: " .. MCP_HTTP_URL .. " | WS: " .. MCP_WS_URL)
    print("[MCP] Worker: " .. tostring(WORKER_ID) .. " | ROUTER entries: " .. tostring(#ROUTER))
    pollLoop()
end)
if not mainOk then warn("[MCP] Fatal: " .. tostring(mainErr)) end
