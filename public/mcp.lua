pcall(function() if not game:IsLoaded() then game.Loaded:Wait() end end)
local G = {}; pcall(function() G = getgenv and getgenv() or _G end)
local HOST = G.MCP_HOST or "127.0.0.1"
local PORT = G.MCP_PORT or 28429
local WS_URL = "ws://" .. HOST .. ":" .. PORT .. "/ws"
local cloneref = cloneref or function(x) return x end
local HttpService = cloneref(game:GetService("HttpService"))
local Players = cloneref(game:GetService("Players"))
local LogService = cloneref(game:GetService("LogService"))
local CoreGui = cloneref(game:GetService("CoreGui"))
local CollectionService = cloneref(game:GetService("CollectionService"))
local MarketplaceService = cloneref(game:GetService("MarketplaceService"))
local RunService = cloneref(game:GetService("RunService"))
local VirtualInputManager = nil
pcall(function() VirtualInputManager = cloneref(Instance.new("VirtualInputManager")) end)
local LocalPlayer = nil; pcall(function() LocalPlayer = Players.LocalPlayer end)
local getnilinstances = getnilinstances or function() return {} end
local fireclickdetector = fireclickdetector or function() end
local fireproximityprompt = fireproximityprompt or function() end
local firesignal = firesignal or function(s) pcall(function() s:Fire() end) end
local getconnections = getconnections or function(i) local o,r=pcall(function() return i:GetConnections() end); return o and r or {} end
local sethiddenproperty = sethiddenproperty or function() end
local gethiddenproperty = gethiddenproperty or function() return nil end
local setscriptable = setscriptable or function() end
local hookfunction = hookfunction or function() end
local newcclosure = newcclosure or function(f) return f end
local getrawmetatable = getrawmetatable or getmetatable
local setrawmetatable = setrawmetatable or function() end
local setreadonly = setreadonly or function() end
local isreadonly = isreadonly or function() return false end
local getnamecallmethod = getnamecallmethod or function() return "" end
local gethui = gethui or function() return CoreGui end
local writefile = writefile or function() end
local readfile = readfile or function() return "" end
local isfile = isfile or function() return false end
local delfile = delfile or function() end
local WORKER_ID = nil
if G.MCP_WORKER_ID then WORKER_ID = G.MCP_WORKER_ID else
    local ok,guid = pcall(function() return HttpService:GenerateGuid(false) end)
    WORKER_ID = ok and guid or (tostring(tick()) .. tostring(math.random(1,999999)))
end
local PROCESS_PID = nil
local function getPid()
    if not PROCESS_PID then
        PROCESS_PID = tostring(game.PlaceId) .. "_" .. tostring(game.JobId)
    end
    return PROCESS_PID
end
local function jsonDecode(str)
    if type(str) ~= "string" or str == "" then return nil end
    local ok,v = pcall(function() return HttpService:JSONDecode(str) end)
    return ok and v or nil
end
local function getFullPath(inst)
    if not inst then return "nil" end
    if inst == game then return "game" end
    if inst == workspace then return "game.Workspace" end
    local p={}; local o=inst
    while o and o ~= game do table.insert(p,1,o.Name); o=o.Parent end
    return "game." .. table.concat(p,".")
end
local function resolvePath(str)
    if type(str) ~= "string" then return nil end
    local clean = str:match("^%s*(.-)%s*$"); if clean == "" then return nil end
    local srv = clean:match('^game%s*:%s*GetService%s*%(%s*["\'](.+?)["\']%s*%)')
    if srv then local o,e=pcall(function() return cloneref(game:GetService(srv)) end); return o and e or nil end
    if clean:sub(1,5) == "game." then clean = clean:sub(6)
    elseif clean:sub(1,10) == "workspace." then clean = "Workspace." .. clean:sub(11)
    elseif clean:sub(1,8) == "players." then clean = "Players." .. clean:sub(9) end
    local parts={}; for p in clean:gmatch("[^.\\/]+") do table.insert(parts,p) end
    if #parts == 0 then return game end
    local obj
    if parts[1] == "game" then obj=game; table.remove(parts,1)
    elseif parts[1] == "Workspace" then obj=workspace; table.remove(parts,1)
    elseif parts[1] == "Players" then obj=Players; table.remove(parts,1)
    elseif parts[1] == "LocalPlayer" then obj=LocalPlayer; table.remove(parts,1)
    else obj=game end
    if #parts == 0 then return obj end
    for _,name in ipairs(parts) do
        local c = obj:FindFirstChild(name)
        if not c then return nil end; obj = c
    end
    return obj
end
local function serialize(v,d)
    d=d or 0; if d>8 then return "<<max>>" end
    local t=typeof(v)
    if t=="string" or t=="number" or t=="boolean" then return v end
    if t=="nil" then return nil end
    if t=="Vector3" then return {x=v.X,y=v.Y,z=v.Z} end
    if t=="Vector2" then return {x=v.X,y=v.Y} end
    if t=="CFrame" then local x,y,z,qx,qy,qz,qw=v:GetComponents(); return {x=x,y=y,z=z,qx=qx,qy=qy,qz=qz,qw=qw} end
    if t=="Color3" then return {r=v.R,g=v.G,b=v.B} end
    if t=="BrickColor" then return v.Name end
    if t=="EnumItem" then return tostring(v) end
    if t=="table" then local r={}; for k,val in pairs(v) do local ks=serialize(k,d+1); if ks~=nil then r[ks]=serialize(val,d+1) end end; return r end
    if t=="Instance" then return {Name=v.Name,ClassName=v.ClassName,Path=getFullPath(v)} end
    return tostring(v)
end

local WS, WS_CONNECTED, WS_BUFFER = nil, false, {}
local MCP_SPY_LOG = {}
local MCP_SPY_NAMEHOOK = nil
local MCP_SPY_INCOMING = {}
local MCP_SPY_WATCHER = nil
local RECONNECT_DELAY = 3

local MCP_CAPABILITIES = {}
pcall(function()
local function testUncCapabilities()
    local cap = {total=0, supported=0, missing={}}
    local uncs = {
        "cloneref","getnilinstances","fireclickdetector","fireproximityprompt",
        "firesignal","getconnections","sethiddenproperty","gethiddenproperty",
        "setscriptable","hookfunction","newcclosure","getrawmetatable",
        "setrawmetatable","setreadonly","isreadonly","getnamecallmethod",
        "gethui","writefile","readfile","isfile","delfile",
        "makefolder","listfiles","getcustomasset",
        "getloadedmodules","getrunningscripts",
        "getscriptbytecode","getscriptclosure","getscripthash",
        "getcallingscript","getsenv","getrenv",
        "hookmetamethod","iscclosure","islclosure",
        "isexecutorclosure","getgc","getreg",
        "compareinstances","identifyexecutor",
        "getgenv","loadstring",
    }
    for _, name in ipairs(uncs) do
        cap.total = cap.total + 1
        local ok = pcall(function()
            local v = _G[name]
            if type(v) ~= "function" then
                local lsOk, lsFn = pcall(loadstring, "return " .. name)
                if lsOk then v = lsFn() end
            end
            return v ~= nil
        end)
        if ok then cap.supported = cap.supported + 1 else table.insert(cap.missing, name) end
    end
    pcall(function() local r={_G.identifyexecutor()}; if type(r[1])=="string" then cap.executorName=r[1] end end)
    pcall(function() cap.hasGenv = (_G.getgenv() ~= nil) end)
    cap.hasVirtualInput = (VirtualInputManager ~= nil)
    cap.missingCount = #cap.missing
    return cap
end
MCP_CAPABILITIES = testUncCapabilities()
end)

local function wsReconnect()
    WS_BUFFER = {}
    if WS then pcall(function() WS:Close() end) end
    WS = nil; WS_CONNECTED = false
    local connectFn = (typeof(WebSocket)=="table" and WebSocket.connect) or nil
    if not connectFn then return false, "No WebSocket support" end
    local ok, s = pcall(connectFn, WS_URL)
    if not ok or not s then return false, tostring(s) end
    WS = s; WS_CONNECTED = true
    local placeName = ""
    pcall(function()
        local pi = MarketplaceService:GetProductInfo(game.PlaceId)
        if pi and pi.Name then placeName = pi.Name end
    end)
    local regData = {type="register", worker_id=WORKER_ID, username=LocalPlayer and LocalPlayer.Name or "Unknown",
        userId=LocalPlayer and LocalPlayer.UserId or 0,
        placeId=game.PlaceId, jobId=game.JobId, placeName=placeName,
        capabilities=MCP_CAPABILITIES
    }
    local ok, sent = pcall(function() WS:Send(HttpService:JSONEncode(regData)) end)
    if not ok then WS = nil; WS_CONNECTED = false; return false, "Register send failed" end
    local savedWS = WS
    WS.OnMessage:Connect(function(msg)
        if WS ~= savedWS then return end
        print("[MCP] >> " .. msg)
        local ok, d = pcall(function() return HttpService:JSONDecode(msg) end)
        if ok and d then
            if d.type == "pong" then lastPong = tick() end
            if d.type == "task" then
                if d.workerId and d.workerId ~= WORKER_ID then return end
                table.insert(WS_BUFFER, d)
            end
        end
    end)
    WS.OnClose:Connect(function()
        if WS == savedWS then WS_CONNECTED = false; WS = nil end
    end)
    return true
end

local function wsPoll()
    if not WS_CONNECTED or not WS then return nil end
    if #WS_BUFFER > 0 then local m = table.remove(WS_BUFFER,1); return {type=m.tool, id=m.id, args=m.args or {}, pid=m.pid} end
    return nil
end

local function wsSend(id, data, err, taskPid)
    if not WS_CONNECTED or not WS then return false end
    local pid = taskPid or getPid()
    return pcall(function() WS:Send(HttpService:JSONEncode({type="result", id=id, data=data, error=err, pid=pid})) end)
end

local function handleGetMetadata(args)
    local data={PlaceId=game.PlaceId,GameId=game.GameId,JobId=game.JobId,CreatorId=game.CreatorId,CreatorType=tostring(game.CreatorType),Name=game.Name,PlayerCount=#Players:GetPlayers(),MaxPlayers=Players.MaxPlayers,ServerTime=tick()}
    if args.include_performance then data.FPS=60; data.Memory=collectgarbage("count") end
    return{success=true,metadata=data}
end
local function handleDumpPlayers(args)
    local results={}
    for _,p in ipairs(Players:GetPlayers()) do
        local entry={Name=p.Name,DisplayName=p.DisplayName,UserId=p.UserId}
        if p.Character then
            entry.Character={Name=p.Character.Name,Path=getFullPath(p.Character)}
            local hum=p.Character:FindFirstChildOfClass("Humanoid")
            if hum and args.include_character_humanoid then entry.Health=hum.Health;entry.MaxHealth=hum.MaxHealth;entry.WalkSpeed=hum.WalkSpeed end
            if args.include_backpack then local bp=p:FindFirstChild("Backpack"); if bp then local items={}; for _,c in ipairs(bp:GetChildren()) do table.insert(items,{Name=c.Name,ClassName=c.ClassName}) end; entry.Backpack=items end end
            if args.include_proximity_prompts then local prompts={}; for _,c in ipairs(p.Character:GetDescendants()) do if c:IsA("ProximityPrompt") then table.insert(prompts,{Name=c.Name,Path=getFullPath(c)}) end end; entry.ProximityPrompts=prompts end
        end
        table.insert(results,entry)
    end
    return{success=true,count=#results,players=results}
end
local function handleDumpRemotes(args)
    local sp=args.search_paths or {"game:GetService(\"ReplicatedStorage\")","game:GetService(\"Workspace\")"}
    local remotes={}
    for _,path in ipairs(sp) do
        local root=resolvePath(path)
        if root then
            local function find(inst)
                if inst:IsA("RemoteEvent") or inst:IsA("RemoteFunction") or inst:IsA("UnreliableRemoteEvent") then table.insert(remotes,{Name=inst.Name,ClassName=inst.ClassName,Path=getFullPath(inst)}) end
                for _,c in ipairs(inst:GetChildren()) do find(c) end
            end; find(root)
        end
    end
    return{success=true,count=#remotes,remotes=remotes}
end
local function handleConsoleLog(args)
    local lt=args.log_type or "all"; local ml=args.max_lines or 100
    local logs=LogService:GetLogHistory(); local entries={}; local count=0
    for i=#logs,1,-1 do if count>=ml then break end; local e=logs[i]; local mt=tostring(e.messageType):lower(); if lt=="all" or mt:find(lt) then table.insert(entries,1,{message=e.message,type=mt,timestamp=e.timestamp or tick()}); count=count+1 end end
    return{success=true,count=#entries,entries=entries}
end
local function handleNetworkOwnership(args)
    local scope,err=resolvePath(args.scope or "game:GetService(\"Workspace\")"); if not scope then return{success=false,error=err} end
    local results={}
    for _,part in ipairs(scope:GetDescendants()) do
        if part:IsA("BasePart") then local ok,owner=pcall(function() return part:GetNetworkOwner() end); table.insert(results,{Name=part.Name,Path=getFullPath(part),clientOwned=ok and owner~=nil,owner=ok and tostring(owner) or "server"}) end
    end
    return{success=true,count=#results,parts=results}
end
local function handleCodeExec(args)
    local code=args.code or ""; if code=="" then return{success=false,error="code required"} end
    local envOverrides=jsonDecode(args.environment_overrides)
    local ok,fn=pcall(loadstring,code); if not ok then return{success=false,error="Compile error: "..tostring(fn)} end
    if envOverrides then for k,v in pairs(envOverrides) do _G[k]=v end end
    local ok2,r=pcall(fn)
    if envOverrides then for k,_ in pairs(envOverrides) do _G[k]=nil end end
    if not ok2 then return{success=false,error="Runtime error: "..tostring(r)} end
    return{success=true,result=serialize(r)}
end
local function handleWorkspaceObjects(args)
    local md=args.max_depth or 20; local mr=args.max_results or 500; local fc=args.class_filter or ""
    local results={}
    local function walk(inst,d) if mr>0 and #results>=mr then return end; if d>md then return end; if d>0 then if fc=="" or inst.ClassName==fc then table.insert(results,{Name=inst.Name,ClassName=inst.ClassName,Path=getFullPath(inst)}) end end; for _,c in ipairs(inst:GetChildren()) do walk(c,d+1) end end
    walk(workspace,0)
    return{success=true,count=#results,objects=results}
end
local function handlePlayerState()
    if not LocalPlayer then return{success=false,error="No LocalPlayer"} end
    local data={DisplayName=LocalPlayer.DisplayName,UserId=LocalPlayer.UserId,Name=LocalPlayer.Name}
    if LocalPlayer.Character then local hum=LocalPlayer.Character:FindFirstChildOfClass("Humanoid"); if hum then data.Health=hum.Health;data.MaxHealth=hum.MaxHealth;data.WalkSpeed=hum.WalkSpeed end end
    return{success=true,player=data}
end
local function handleRemoteFire(args)
    local rp=args.remote_path or ""; if rp=="" then return{success=false,error="remote_path required"} end
    local inst,err=resolvePath(rp); if not inst then return{success=false,error=err} end
    local fa=jsonDecode(args.arguments) or args.args or {}; local method=args.method or "FireServer"
    local ok,r=pcall(function() if method=="FireServer" then inst:FireServer(table.unpack(fa)); return{fired=true} else return inst:InvokeServer(table.unpack(fa)) end end)
    if not ok then return{success=false,error="Failed: "..tostring(r)} end
    return{success=true,result=serialize(r)}
end
local function handleRemoteConns(args)
    local rp=args.remote_path or ""; if rp=="" then return{success=false,error="remote_path required"} end
    local inst,err=resolvePath(rp); if not inst then return{success=false,error=err} end
    local conns=getconnections(inst); local results={}
    for _,c in ipairs(conns) do table.insert(results,{connected=c.Connected,enabled=c.Enabled,functionInfo=tostring(c.Function)}) end
    return{success=true,count=#results,connections=results}
end
local function handleTreeExplore(args)
    local action=args.action or "walk"
    if action=="walk" then
        local root,err=resolvePath(args.start_path or "game"); if not root then return{success=false,error=err} end
        local md=args.max_depth or 10; local mr=args.max_results or 200; local fc=args.class_filter or ""; local np=args.name_pattern or ""
        local results={}
        local function walk(inst,d) if mr>0 and #results>=mr then return end; if md>=0 and d>md then return end
            if d>0 then local match=true; if fc~="" then local cls={}; for c in fc:gmatch("[^,]+") do cls[c:match("^%s*(.-)%s*$") or ""]=true end; if next(cls) and not cls[inst.ClassName] then match=false end end; if match and np~="" then match=inst.Name:lower():find(np:lower())~=nil end; if match then table.insert(results,{Name=inst.Name,ClassName=inst.ClassName,Path=getFullPath(inst)}) end end
            for _,c in ipairs(inst:GetChildren()) do walk(c,d+1) end end
        walk(root,0)
        return{success=true,count=#results,instances=results}
    end
    if action=="services" then local results={}; for _,c in ipairs(game:GetChildren()) do if c.ClassName:find("Service") or c.ClassName:find("Provider") then table.insert(results,{Name=c.Name,ClassName=c.ClassName,Path=getFullPath(c)}) end end; return{success=true,count=#results,services=results} end
    if action=="children" then local inst,err=resolvePath(args.instance_path or "game"); if not inst then return{success=false,error=err} end; local children={}; for _,c in ipairs(inst:GetChildren()) do table.insert(children,{Name=c.Name,ClassName=c.ClassName}) end; return{success=true,count=#children,children=children} end
    if action=="path_resolve" then local inst=resolvePath(args.path or ""); if not inst then return{success=false,error="Path not found"} end; return{success=true,instance={Name=inst.Name,ClassName=inst.ClassName,Path=getFullPath(inst)}} end
    if action=="subtree" then local root,err=resolvePath(args.start_path or "game"); if not root then return{success=false,error=err} end; local md=args.max_depth or 10; local results={}
        local function walk(inst,d) if md>=0 and d>md then return nil end; local e={Name=inst.Name,ClassName=inst.ClassName,children={}}; for _,c in ipairs(inst:GetChildren()) do local s=walk(c,d+1); if s then table.insert(e.children,s) end end; if d>0 or e.Name~="game" then return e end; results=e.children; return nil end
        walk(root,0); return{success=true,tree=results}
    end
    if action=="proximity" then local pos=args.position or {x=0,y=0,z=0}; local radius=args.radius or 50; local root,err=resolvePath(args.scope or "game.Workspace"); if not root then return{success=false,error=err} end; local mr=args.max_results or 200; local results={}
        local function walk(inst) if mr>0 and #results>=mr then return end; local ok,cf=pcall(function() return inst:GetPivot() end); if ok then local dx=cf.Position.X-pos.x;local dy=cf.Position.Y-pos.y;local dz=cf.Position.Z-pos.z;local dist=math.sqrt(dx*dx+dy*dy+dz*dz);if dist<=radius then table.insert(results,{Name=inst.Name,ClassName=inst.ClassName,Path=getFullPath(inst),distance=dist}) end end; for _,c in ipairs(inst:GetChildren()) do walk(c) end end
        walk(root); return{success=true,count=#results,instances=results}
    end
    if action=="tag_collect" then local tn=args.tag_name or ""; if tn=="" then return{success=false,error="tag_name required"} end; local ok,instances=pcall(function() return CollectionService:GetTagged(tn) end); if not ok then return{success=false,error="CollectionService error"} end; local mr=args.max_results or 200; local results={}; local c=0; for _,inst in ipairs(instances) do if mr>0 and c>=mr then break end; table.insert(results,{Name=inst.Name,ClassName=inst.ClassName,Path=getFullPath(inst)});c=c+1 end; return{success=true,count=#results,instances=results} end
    if action=="attribute_seek" then local an=args.attribute_name or ""; local av=args.attribute_value; local root,err=resolvePath(args.scope or "game"); if not root then return{success=false,error=err} end; local mr=args.max_results or 200; local results={}
        local function walk(inst) if mr>0 and #results>=mr then return end; local ha,val=pcall(function() return inst:GetAttribute(an) end); if ha and val~=nil and (av==nil or val==av) then table.insert(results,{Name=inst.Name,ClassName=inst.ClassName,Path=getFullPath(inst)}) end; for _,c in ipairs(inst:GetChildren()) do walk(c) end end
        walk(root); return{success=true,count=#results,instances=results}
    end
    if action=="clickdetector" then local target=args.target_path or ""; if target=="" then return{success=false,error="target_path required"} end; local inst,err=resolvePath(target); if not inst then return{success=false,error=err} end; local cd=inst:FindFirstChildOfClass("ClickDetector"); if not cd then return{success=false,error="No ClickDetector"} end; fireclickdetector(cd); return{success=true,message="Fired ClickDetector"} end
    if action=="proximity_prompt" then local target=args.target_path or ""; if target=="" then return{success=false,error="target_path required"} end; local inst,err=resolvePath(target); if not inst then return{success=false,error=err} end; local pp=inst:FindFirstChildOfClass("ProximityPrompt"); if not pp then return{success=false,error="No ProximityPrompt"} end; fireproximityprompt(pp); return{success=true,message="Fired ProximityPrompt"} end
    if action=="nil_realm" then local fc=args.filter_by_class or ""; local mi=args.max_instances or 200; local results={}; for _,c in ipairs(getnilinstances()) do if mi>0 and #results>=mi then break end; if fc=="" or c.ClassName==fc then table.insert(results,{Name=c.Name,ClassName=c.ClassName,Path=getFullPath(c)}) end end; return{success=true,count=#results,instances=results} end
    return{success=false,error="Unknown action: "..tostring(action)}
end
local function handlePropertyRead(args)
    local inst,err=resolvePath(args.instance_path or args.path or "game"); if not inst then return{success=false,error=err} end
    local pn=args.properties or {"Name","ClassName"}; local result={_path=getFullPath(inst),_className=inst.ClassName}
    for _,p in ipairs(pn) do local ok,v=pcall(function() return inst[p] end); if ok then result[p]=serialize(v) end end
    return{success=true,data=result}
end
local function handleGuiInject(args)
    local gt=args.gui_type or "ScreenGui"; local gn=args.gui_name or "McpOverlay"; local pp=args.parent_path or "game:GetService(\"CoreGui\")"
    local parent,err=resolvePath(pp); if not parent then return{success=false,error="Parent not found"} end
    local props=jsonDecode(args.properties) or {}
    local ok,ng=pcall(function() local inst=Instance.new(gt); inst.Name=gn; for k,v in pairs(props) do inst[k]=v end; inst.Parent=parent; return inst end)
    if not ok then return{success=false,error="GUI create failed: "..tostring(ng)} end
    return{success=true,name=gn,instance_path=getFullPath(ng)}
end
local function handleGuiDump(args)
    local root=gethui(); local md=args.max_depth or 10; local results={}
    local function walk(inst,d) if d>md then return end; local e={Name=inst.Name,ClassName=inst.ClassName}; if inst.ClassName:find("Gui") or inst.ClassName:find("Button") or inst.ClassName:find("Label") or inst.ClassName:find("Box") then for _,p in ipairs({"Position","Size","Text","TextColor3","BackgroundColor3","Visible"}) do local ok,v=pcall(function() return inst[p] end); if ok then e[p]=serialize(v) end end end; e.children={}; for _,c in ipairs(inst:GetChildren()) do table.insert(e.children,walk(c,d+1)) end; return e end
    for _,c in ipairs(root:GetChildren()) do table.insert(results,walk(c,0)) end
    return{success=true,guiTree=results}
end
local function handleFileOp(args)
    local a=args.action or "read"; local p=args.path or ""
    if a=="read" then if p=="" then return{success=false,error="path required"} end; local ok,c=pcall(readfile,p); if not ok then return{success=false,error="readfile failed"} end; return{success=true,path=p,content=c,size=#c} end
    if a=="write" then local c=args.content or ""; if p=="" then return{success=false,error="path required"} end; pcall(writefile,p,c); return{success=true,path=p,bytes=#c} end
    if a=="delete" then if p=="" then return{success=false,error="path required"} end; pcall(delfile,p); return{success=true,deleted=p} end
    if a=="list" then local ok,files=pcall(listfiles,p); if not ok then return{success=false,error="listfiles failed"} end; local r={}; for _,f in ipairs(files) do table.insert(r,{name=f,isFile=pcall(isfile,f) and isfile(f) or false}) end; return{success=true,count=#r,files=r} end
    return{success=false,error="Unknown action"}
end
local function handleHiddenProp(args)
    local a=args.action or "get"; local prop=args.property or ""; local path=args.instance_path or ""
    if prop=="" then return{success=false,error="property required"} end; local inst,err=resolvePath(path); if not inst then return{success=false,error=err} end
    if a=="get" then local ok,val=pcall(gethiddenproperty,inst,prop); if not ok then return{success=false,error="Cannot read hidden property"} end; return{success=true,property=prop,value=serialize(val)} end
    if a=="set" then local val=args.value; local ok=pcall(sethiddenproperty,inst,prop,val); if not ok then return{success=false,error="Cannot set hidden property"} end; return{success=true,property=prop} end
    if a=="make_scriptable" then pcall(setscriptable,inst,prop,true); return{success=true,message=prop.." is now scriptable"} end
    return{success=false,error="Unknown action"}
end
local function handleStateBypass(args)
    local a=args.action or "speed"
    if not LocalPlayer or not LocalPlayer.Character then return{success=false,error="No character"} end
    local hum=LocalPlayer.Character:FindFirstChildOfClass("Humanoid"); if not hum then return{success=false,error="No Humanoid"} end
    if a=="noclip" then local state=args.state or true; for _,part in ipairs(LocalPlayer.Character:GetDescendants()) do if part:IsA("BasePart") then part.CanCollide=not state end end; return{success=true} end
    if a=="speed" then hum.WalkSpeed=args.walk_speed or 50; return{success=true} end
    if a=="jump" then hum.JumpPower=args.jump_power or 100; return{success=true} end
    if a=="health" then if args.mode=="heal_to_full" then hum.Health=hum.MaxHealth else hum.Health=args.health_value or hum.MaxHealth end; return{success=true} end
    if a=="teleport" then local hrp=LocalPlayer.Character:FindFirstChild("HumanoidRootPart"); if not hrp then return{success=false,error="No HRP"} end; local c=args.coordinates or {x=0,y=0,z=0}; hrp.CFrame=CFrame.new(Vector3.new(c.x,c.y,c.z)); return{success=true} end
    return{success=false,error="Unknown action"}
end
local function handleInputSim(args)
    local a=args.action or "mouse_click"
    if a=="key_press" then local key=args.key or ""; if key=="" then return{success=false,error="key required"} end; local vk=Enum.KeyCode[key]; if not vk then return{success=false,error="Unknown key"} end; if VirtualInputManager then pcall(function() VirtualInputManager:SendKeyEvent(true,vk,false,game); task.wait(0.03); VirtualInputManager:SendKeyEvent(false,vk,false,game) end) end; return{success=true,key=key} end
    if a=="mouse_click" then pcall(function() local m=LocalPlayer:GetMouse(); m.Button1Down=true; task.wait(0.05); m.Button1Down=false end); return{success=true} end
    if a=="char_move" then if not LocalPlayer.Character then return{success=false,error="No character"} end; local hrp=LocalPlayer.Character:FindFirstChild("HumanoidRootPart"); if not hrp then return{success=false,error="No HRP"} end; local t=args.target_position or {x=0,y=0,z=0}; hrp.CFrame=CFrame.new(Vector3.new(t.x,t.y,t.z)); return{success=true} end
    return{success=false,error="Unknown input action"}
end
local function handleSandboxExec(args)
    setthreadidentity(8); local code=args.code or ""; if code=="" then return{success=false,error="code required"} end
    local ok,fn=pcall(loadstring,code); if not ok then return{success=false,error="Compile: "..tostring(fn)} end
    local ok2,r=pcall(fn); if not ok2 then return{success=false,error="Runtime: "..tostring(r)} end
    return{success=true,result=serialize(r)}
end

local function handleGetLoadedModules(args)
    local filter = (args.filter_by_name or ""):lower()
    local max = args.max_results or 100
    local results = {}; local count = 0
    local ok, modules = pcall(getloadedmodules)
    if not ok then return {success=false, error="getloadedmodules not supported"} end
    for _, m in ipairs(modules) do
        if count >= max then break end
        if filter == "" or m.Name:lower():find(filter, 1, true) then
            local entry = {Name=m.Name, ClassName=m.ClassName, Path=getFullPath(m)}
            if args.include_source then
                local ok2, bc = pcall(getscriptbytecode, m)
                if ok2 then entry.BytecodeSize = #(bc or "") end
            end
            table.insert(results, entry); count = count + 1
        end
    end
    return {success=true, count=#results, modules=results}
end

local function handleRunningScripts(args)
    local filter = args.filter_by_class or ""
    local max = args.max_scripts or 100
    local incSrc = args.include_source or false
    local results = {}; local count = 0
    local ok, scripts = pcall(getrunningscripts)
    if not ok then return {success=false, error="getrunningscripts not supported"} end
    for _, s in ipairs(scripts) do
        if count >= max then break end
        if filter == "" or s.ClassName == filter then
            local entry = {Name=s.Name, ClassName=s.ClassName, Path=getFullPath(s)}
            if incSrc then
                local ok2, bc = pcall(getscriptbytecode, s)
                if ok2 then entry.BytecodeSize = #(bc or "") end
            end
            table.insert(results, entry); count = count + 1
        end
    end
    return {success=true, count=#results, scripts=results}
end

local function handleScriptSource(args)
    local path = args.script_path or ""
    if path == "" then return {success=false, error="script_path required"} end
    local inst, err = resolvePath(path)
    if not inst then return {success=false, error=err} end
    local ok, bc = pcall(getscriptbytecode, inst)
    if not ok then return {success=false, error="getscriptbytecode not supported or script has no bytecode"} end
    return {success=true, name=inst.Name, className=inst.ClassName, path=getFullPath(inst), bytecode=bc, bytecodeSize=#(bc or "")}
end

local function handleScriptClosure(args)
    local path = args.script_path or ""
    if path == "" then return {success=false, error="script_path required"} end
    local inst, err = resolvePath(path)
    if not inst then return {success=false, error=err} end
    local ok, fn = pcall(getscriptclosure, inst)
    if not ok then return {success=false, error="getscriptclosure not supported"} end
    return {success=true, name=inst.Name, hasClosure=fn~=nil, closureType=typeof(fn)}
end

local function handleScriptHash(args)
    local path = args.script_path or ""
    if path == "" then return {success=false, error="script_path required"} end
    local inst, err = resolvePath(path)
    if not inst then return {success=false, error=err} end
    local ok, hash = pcall(getscripthash, inst)
    if not ok then return {success=false, error="getscripthash not supported"} end
    return {success=true, name=inst.Name, hash=hash}
end

local function handleCallingScript()
    local ok, s = pcall(getcallingscript)
    if not ok then return {success=false, error="getcallingscript not supported"} end
    if not s then return {success=true, script=nil} end
    return {success=true, script={Name=s.Name, ClassName=s.ClassName, Path=getFullPath(s)}}
end

local function handleScriptEnv(args)
    local path = args.script_path or ""
    if path == "" then return {success=false, error="script_path required"} end
    local inst, err = resolvePath(path)
    if not inst then return {success=false, error=err} end
    local ok, env = pcall(getsenv, inst)
    if not ok then return {success=false, error="getsenv not supported or script not running"} end
    local keys = {}; local maxK = args.max_keys or 50; local count = 0
    for k, v in pairs(env) do
        if count >= maxK then break end
        table.insert(keys, {key=tostring(k), valueType=typeof(v)})
        count = count + 1
    end
    return {success=true, name=inst.Name, environment=keys, totalKeys=count}
end

local function handleRobloxEnv()
    local ok, env = pcall(getrenv)
    if not ok then return {success=false, error="getrenv not supported"} end
    local keys = {}; local count = 0
    for k, v in pairs(env) do
        if count >= 100 then break end
        table.insert(keys, {key=tostring(k), valueType=typeof(v)}); count = count + 1
    end
    return {success=true, environment=keys, totalKeys=count}
end

local function handleScriptDecompiler(args)
    local path = args.script_path or ""
    if path == "" then return {success=false, error="script_path required"} end
    local inst, err = resolvePath(path)
    if not inst then return {success=false, error=err} end
    local ok, bc = pcall(getscriptbytecode, inst)
    if not ok then return {success=false, error="Cannot read bytecode"} end
    local fn, compErr = loadstring(bc)
    if not fn then return {success=true, bytecodeSize=#(bc or ""), decompiled=false, compileError=tostring(compErr)} end
    local sourceInfo = debug and debug.getinfo and {pcall(function() return debug.getinfo(fn, "S") end)}
    local source = ""
    if sourceInfo and sourceInfo[1] then
        source = sourceInfo[1].source or ""
    end
    return {success=true, name=inst.Name, bytecodeSize=#(bc or ""), hasFunction=fn~=nil, source=source}
end

local function handleSandboxAnalysis(args)
    local identity = 0; pcall(function() identity = getthreadidentity() end)
    local isExecutor = false; pcall(function() isExecutor = isexecutorclosure(function() end) end)
    local caps = {
        has_getgc = pcall(getgc) or false,
        has_getreg = pcall(getreg) or false,
        has_hookfunction = pcall(hookfunction, function() end, function() end) or false,
        has_getscriptbytecode = pcall(getscriptbytecode, Instance.new("LocalScript")) or false,
    }
    return {success=true, threadIdentity=identity, isExecutorContext=isExecutor, capabilities=caps}
end

local function handleNamecallSpy(args)
    local target = args.target_path or ""
    if target == "" then return {success=false, error="target_path required"} end
    local inst, err = resolvePath(target)
    if not inst then return {success=false, error=err} end
    local maxCalls = args.max_calls or 50
    local methodFilter = args.method_filter or ""
    local capturedLog = {}
    local ok, original = pcall(hookmetamethod, inst, "__namecall", function(...)
        if #capturedLog >= maxCalls then return original(...) end
        local method = getnamecallmethod()
        if methodFilter == "" or method == methodFilter then
            local self = ...
            table.insert(capturedLog, {method=method, self=tostring(self), timestamp=tick()})
        end
        return original(...)
    end)
    if not ok then return {success=false, error="hookmetamethod not supported: "..tostring(original)} end
    return {success=true, hookActive=true, maxCalls=maxCalls, methodFilter=methodFilter, captured=#capturedLog}
end

local function handleMetatableSeer(args)
    local target = args.target_path or ""
    if target == "" then return {success=false, error="target_path required"} end
    local inst, err = resolvePath(target)
    if not inst then return {success=false, error=err} end
    local mt = getrawmetatable(inst)
    if not mt then return {success=true, hasMetatable=false} end
    local methods = args.metamethods or {"__index","__newindex","__call","__namecall","__tostring","__gc","__eq","__add","__sub","__mul","__div","__unm","__len","__lt","__le","__concat","__mode"}
    local result = {}
    for _, m in ipairs(methods) do result[m] = mt[m] ~= nil end
    return {success=true, hasMetatable=true, metamethods=result, isReadonly=isreadonly(mt)}
end

local function handleMetatableModifier(args)
    local target = args.target_path or ""
    if target == "" then return {success=false, error="target_path required"} end
    local inst, err = resolvePath(target)
    if not inst then return {success=false, error=err} end
    local action = args.action or "read"
    if action == "set_readonly" then
        local state = args.state == nil and false or args.state
        local ok2 = pcall(setreadonly, getrawmetatable(inst), state)
        if not ok2 then return {success=false, error="setreadonly failed"} end
        return {success=true, action="set_readonly", state=state}
    end
    if action == "set_raw" then
        if not args.new_metatable then return {success=false, error="new_metatable required"} end
        pcall(setrawmetatable, inst, args.new_metatable)
        return {success=true, action="set_raw"}
    end
    return {success=false, error="Unknown action: "..tostring(action)}
end

local function handleFuncInterceptor(args)
    local action = args.action or "install"
    local funcPath = args.function_path or ""
    if funcPath == "" then return {success=false, error="function_path required"} end
    local target; local isInstance = false
    local inst = resolvePath(funcPath)
    if inst then target = inst; isInstance = true
    else
        local ok, fn = pcall(loadstring, "return " .. funcPath)
        if ok and type(fn) == "function" then
            local ok2, resolved = pcall(fn)
            if ok2 then target = resolved end
        end
    end
    if not target then return {success=false, error="Cannot resolve: "..funcPath} end
    local hookCode = args.hook_code or ""
    local hookFn = nil
    if hookCode ~= "" then
        local ok3, compiled = pcall(loadstring, hookCode)
        if not ok3 then return {success=false, error="Failed to compile hook: "..tostring(compiled)} end
        hookFn = compiled
    end
    if action == "install" and hookFn then
        local ok4, orig = pcall(hookfunction, target, hookFn)
        if not ok4 then return {success=false, error="hookfunction not supported: "..tostring(orig)} end
        return {success=true, action="installed", hasOriginal=orig~=nil}
    end
    if action == "remove" then
        return {success=true, action="removed", note="Hook removal requires original reference, use with care"}
    end
    return {success=true, action="inspected", type=typeof(target), isInstance=isInstance}
end

local function handleClosureType(args)
    local path = args.closure_path or ""
    if path == "" then return {success=false, error="closure_path required"} end
    local ok, fn = pcall(loadstring, "return "..path)
    if not ok or type(fn) ~= "function" then
        local inst = resolvePath(path)
        if inst then
            local ok2, sc = pcall(getscriptclosure, inst)
            if not ok2 then return {success=false, error="Cannot resolve to a closure"} end
            fn = sc
        else return {success=false, error="Cannot resolve: "..path} end
    end
    local ok3, resolved = pcall(fn)
    if not ok3 then return {success=false, error="Cannot evaluate: "..path} end
    local result = {type=typeof(resolved)}
    pcall(function() result.isCClosure = iscclosure(resolved) end)
    pcall(function() result.isLClosure = islclosure(resolved) end)
    pcall(function() result.isExecutorClosure = isexecutorclosure(resolved) end)
    return {success=true, closure=result}
end

local function handleRegistryScan(args)
    local filter = (args.filter_key or ""):lower()
    local max = args.max_results or 200
    local ok, reg = pcall(getreg)
    if not ok then return {success=false, error="getreg not supported"} end
    local results = {}; local count = 0
    for k, v in pairs(reg) do
        if count >= max then break end
        local ks = tostring(k)
        if filter == "" or ks:lower():find(filter, 1, true) then
            table.insert(results, {key=ks, valueType=typeof(v)})
            count = count + 1
        end
    end
    return {success=true, count=#results, entries=results}
end

local function handleGCScan(args)
    local includeTables = args.include_tables or false
    local filterType = args.filter_type or ""
    local max = args.max_results or 200
    local ok, objects = pcall(getgc, includeTables)
    if not ok then return {success=false, error="getgc not supported"} end
    local results = {}; local count = 0
    for _, v in pairs(objects) do
        if count >= max then break end
        local vt = typeof(v)
        if filterType == "" or vt:find(filterType, 1, true) then
            table.insert(results, {type=vt, ref=tostring(v):sub(1, 80)})
            count = count + 1
        end
    end
    return {success=true, count=#results, objects=results}
end

local function handleClosureInspect(args)
    local path = args.closure_path or ""
    if path == "" then return {success=false, error="closure_path required"} end
    local ok, fn = pcall(loadstring, "return "..path)
    if not ok or type(fn) ~= "function" then return {success=false, error="Cannot resolve closure"} end
    local ok2, resolved = pcall(fn)
    if not ok2 or type(resolved) ~= "function" then return {success=false, error="Not a function"} end
    local upvalues = {}
    pcall(function()
        local names = debug and debug.getupvalues or {}
        for i = 1, 100 do
            local n, v = debug.getupvalue(resolved, i)
            if not n then break end
            table.insert(upvalues, {name=n, valueType=typeof(v)})
        end
    end)
    local constants = {}
    pcall(function()
        for i = 1, 100 do
            local n, v = debug.getconstant(resolved, i)
            if not n then break end
            table.insert(constants, {index=n, valueType=typeof(v)})
        end
    end)
    return {success=true, upvalues=upvalues, constants=constants, upvalueCount=#upvalues, constantCount=#constants}
end

local function handleDumpConstants(args)
    local path = args.function_path or ""
    if path == "" then return {success=false, error="function_path required"} end
    local ok, fn = pcall(loadstring, "return "..path)
    if not ok or type(fn) ~= "function" then return {success=false, error="Cannot resolve function"} end
    local ok2, resolved = pcall(fn)
    if not ok2 or type(resolved) ~= "function" then return {success=false, error="Not a function"} end
    local constants = {}; local upvalues = {}
    pcall(function()
        for i = 1, 100 do
            local n, v = debug.getconstant(resolved, i)
            if not n then break end
            table.insert(constants, {index=n, value=tostring(v), type=typeof(v)})
        end
    end)
    pcall(function()
        for i = 1, 100 do
            local n, v = debug.getupvalue(resolved, i)
            if not n then break end
            table.insert(upvalues, {name=n, value=tostring(v), type=typeof(v)})
        end
    end)
    return {success=true, constants=constants, upvalues=upvalues, constantCount=#constants, upvalueCount=#upvalues}
end

local function handleDebugInfo(args)
    local path = args.function_path or ""
    if path == "" then return {success=false, error="function_path required"} end
    local ok, fn = pcall(loadstring, "return "..path)
    if not ok or type(fn) ~= "function" then return {success=false, error="Cannot resolve function"} end
    local ok2, resolved = pcall(fn)
    if not ok2 or type(resolved) ~= "function" then return {success=false, error="Not a function"} end
    local info = {}; local stack = {}
    pcall(function()
        local di = debug.getinfo(resolved, "SLfna")
        if di then info = {name=di.name, source=di.source, linedefined=di.linedefined, lastlinedefined=di.lastlinedefined, nups=di.nups, func=di.func~=nil, isVararg=di.isvararg} end
    end)
    pcall(function()
        for i = 1, 20 do
            local ok3, si = pcall(debug.getinfo, i, "Slnf")
            if ok3 and si then table.insert(stack, {name=si.name or "?", source=si.source or "?", line=si.currentline}) end
        end
    end)
    return {success=true, info=info, stackTrace=stack}
end

local function handleRemoteSpy(args)
    local action = args.action or "install"
    local filter = args.filter_remote_path or ""
    local maxLog = args.max_log_entries or args.max_logs or 500
    local includeBind = args.include_bindables or false

    if action == "install" or action == "install_outgoing" then
        if MCP_SPY_NAMEHOOK then return {success=true, action="already_installed_outgoing"} end
        MCP_SPY_LOG = {}
        local cls = {RemoteEvent="FireServer", RemoteFunction="InvokeServer", UnreliableRemoteEvent="FireServer"}
        if includeBind then cls.BindableEvent="Fire"; cls.BindableFunction="Invoke" end
        local ok, orig = pcall(hookmetamethod, game, "__namecall", function(self, ...)
            local m = getnamecallmethod()
            if typeof(self)=="Instance" and cls[self.ClassName] and cls[self.ClassName]==m then
                if #MCP_SPY_LOG < maxLog and (filter=="" or self.Name:find(filter,1,true)) then
                    table.insert(MCP_SPY_LOG, {remote=self.Name, remotePath=getFullPath(self), method=m, direction="outgoing", args={...}, timestamp=tick()})
                end
            end
            return orig(self, ...)
        end)
        if not ok then return {success=false, error="Cannot hook __namecall: "..tostring(orig)} end
        MCP_SPY_NAMEHOOK = orig
        return {success=true, action="outgoing_installed"}
    end

    if action == "install_incoming" or action == "install" then
        MCP_SPY_INCOMING = MCP_SPY_INCOMING or {}; MCP_SPY_INCOMING_CT = 0
        local function hookEvt(inst)
            if MCP_SPY_INCOMING[inst] then return end
            local conns = {}
            if inst:IsA("RemoteEvent") or inst:IsA("UnreliableRemoteEvent") then
                local ok, c = pcall(function() return inst.OnClientEvent:Connect(function(...)
                    if #MCP_SPY_LOG < maxLog and (filter=="" or inst.Name:find(filter,1,true)) then
                        table.insert(MCP_SPY_LOG, {remote=inst.Name, remotePath=getFullPath(inst), method="OnClientEvent", direction="incoming", args={...}, timestamp=tick()})
                    end
                end) end)
                if ok then table.insert(conns, c) end
            end
            if includeBind and inst:IsA("BindableEvent") then
                local ok, c = pcall(function() return inst.Event:Connect(function(...)
                    if #MCP_SPY_LOG < maxLog and (filter=="" or inst.Name:find(filter,1,true)) then
                        table.insert(MCP_SPY_LOG, {remote=inst.Name, remotePath=getFullPath(inst), method="Event", direction="incoming", args={...}, timestamp=tick()})
                    end
                end) end)
                if ok then table.insert(conns, c) end
            end
            if inst:IsA("RemoteFunction") then
                local mt = getrawmetatable(inst)
                if mt then
                    local origNewIdx = mt.__newindex
                    if origNewIdx then
                        pcall(hookmetamethod, inst, "__newindex", function(self2, k, v)
                            if k=="OnClientInvoke" and type(v)=="function" then
                                local wrapped = function(...)
                                    if #MCP_SPY_LOG < maxLog and (filter=="" or inst.Name:find(filter,1,true)) then
                                        table.insert(MCP_SPY_LOG, {remote=inst.Name, remotePath=getFullPath(inst), method="OnClientInvoke", direction="incoming", args={...}, timestamp=tick()})
                                    end
                                    local r = {v(...)}
                                    if #r>0 then table.insert(MCP_SPY_LOG, {remote=inst.Name, method="OnClientInvokeResult", direction="incoming", args=r, timestamp=tick()}) end
                                    return table.unpack(r,1,#r)
                                end
                                return origNewIdx(self2, k, wrapped)
                            end
                            return origNewIdx(self2, k, v)
                        end)
                    end
                end
            end
            if #conns>0 then MCP_SPY_INCOMING[inst]=conns; MCP_SPY_INCOMING_CT=MCP_SPY_INCOMING_CT+1 end
        end
        local function scan(inst)
            pcall(hookEvt, inst)
            for _, c in ipairs(inst:GetChildren()) do scan(c) end
        end
        for _, sv in ipairs({ReplicatedStorage, workspace, Players, ServerScriptService, ServerStorage, StarterGui}) do
            if sv then pcall(scan, sv) end
        end
        if not MCP_SPY_WATCHER then
            MCP_SPY_WATCHER = game.DescendantAdded:Connect(function(inst)
                if not MCP_SPY_INCOMING[inst] then pcall(hookEvt, inst) end
            end)
        end
        return {success=true, action="incoming_installed", remotesHooked=MCP_SPY_INCOMING_CT}
    end

    if action == "get_log" then
        local max = args.max_results or 500; local entries = {}
        for i = 1, math.min(#(MCP_SPY_LOG or {}), max) do entries[i] = MCP_SPY_LOG[i] end
        return {success=true, entries=entries, total=#(MCP_SPY_LOG or {})}
    end

    if action == "clear" then MCP_SPY_LOG = {}; return {success=true} end

    if action == "remove" then
        if MCP_SPY_NAMEHOOK then pcall(hookmetamethod, game, "__namecall", MCP_SPY_NAMEHOOK); MCP_SPY_NAMEHOOK = nil end
        if MCP_SPY_WATCHER then pcall(function() MCP_SPY_WATCHER:Disconnect() end); MCP_SPY_WATCHER = nil end
        if MCP_SPY_INCOMING then
            for _, conns in pairs(MCP_SPY_INCOMING) do
                if type(conns)=="table" then for _, c in ipairs(conns) do pcall(function() c:Disconnect() end) end end
            end
            MCP_SPY_INCOMING = {}
        end
        MCP_SPY_INCOMING_CT = 0
        return {success=true, action="removed"}
    end
    return {success=false, error="Unknown action: "..tostring(action)}
end

local function handleTrafficInterceptor(args)
    local action = args.action or "install"
    local path = args.remote_path or ""
    local inst, err = resolvePath(path)
    if not inst then return {success=false, error=err} end
    if action == "install" then
        local ok, orig = pcall(hookmetamethod, inst, "__namecall", function(self, ...)
            local method = getnamecallmethod()
            if method == "FireServer" or method == "InvokeServer" then return nil end
            return orig(self, ...)
        end)
        if not ok then return {success=false, error="Cannot hook remote"} end
        return {success=true, action="intercepted", remotePath=path}
    end
    if action == "remove" then
        return {success=true, action="released", remotePath=path}
    end
    if action == "block" then
        local ok, orig = pcall(hookmetamethod, inst, "__namecall", function(self, ...)
            local method = getnamecallmethod()
            if method == "FireServer" then return nil end
            if method == "InvokeServer" then return nil end
            return orig(self, ...)
        end)
        if not ok then return {success=false, error="Cannot block remote"} end
        return {success=true, action="blocked", remotePath=path}
    end
    return {success=false, error="Unknown action"}
end

local function handleArgSpoofer(args)
    local path = args.remote_path or ""
    if path == "" then return {success=false, error="remote_path required"} end
    local inst, err = resolvePath(path)
    if not inst then return {success=false, error=err} end
    local spoofArgs = args.spoof_arguments or {}
    local ok, orig = pcall(hookmetamethod, inst, "__namecall", function(self, ...)
        local method = getnamecallmethod()
        if method == "FireServer" then
            return orig(self, table.unpack(spoofArgs))
        end
        return orig(self, ...)
    end)
    if not ok then return {success=false, error="Cannot hook remote"} end
    return {success=true, remotePath=path, spoofedArgs=spoofArgs}
end

local function handleInstanceComparer(args)
    local a = args.instance_a or ""; local b = args.instance_b or ""
    if a == "" or b == "" then return {success=false, error="instance_a and instance_b required"} end
    local instA = resolvePath(a); local instB = resolvePath(b)
    if not instA then return {success=false, error="Cannot resolve: "..a} end
    if not instB then return {success=false, error="Cannot resolve: "..b} end
    local same = false; pcall(function() same = compareinstances(instA, instB) end)
    if same == nil then same = (instA == instB) end
    return {success=true, instanceA={Name=instA.Name, Path=getFullPath(instA)}, instanceB={Name=instB.Name, Path=getFullPath(instB)}, sameReference=same, sameClass=instA.ClassName==instB.ClassName}
end

local function handleSiblingEnum(args)
    local path = args.instance_path or "game"
    local inst, err = resolvePath(path)
    if not inst then return {success=false, error=err} end
    local parent = inst.Parent
    if not parent then return {success=true, siblings={}, count=0, message="Root object, no parent"} end
    local results = {}
    for _, c in ipairs(parent:GetChildren()) do
        table.insert(results, {Name=c.Name, ClassName=c.ClassName, Path=getFullPath(c), isSelf=c==inst})
    end
    return {success=true, count=#results, siblings=results}
end

local function handlePropertySeeker(args)
    local propName = args.property_name or ""
    if propName == "" then return {success=false, error="property_name required"} end
    local propValue = args.property_value
    local scope = args.scope or "game"
    local maxResults = args.max_results or 100
    local root, err = resolvePath(scope)
    if not root then return {success=false, error=err} end
    local results = {}; local count = 0
    local function walk(inst)
        if count >= maxResults then return end
        local ok, val = pcall(function() return inst[propName] end)
        if ok and (propValue == nil or val == propValue) then
            table.insert(results, {Name=inst.Name, ClassName=inst.ClassName, Path=getFullPath(inst), value=tostring(val)})
            count = count + 1
        end
        for _, c in ipairs(inst:GetChildren()) do walk(c) end
    end
    walk(root)
    return {success=true, count=#results, instances=results}
end

local function handleDataModelExplore(args)
    local root, err = resolvePath(args.start_path or "game")
    if not root then return {success=false, error=err} end
    local maxDepth = args.max_depth or 3
    local maxResults = args.max_results or 100
    local results = {}
    local function walk(inst, depth)
        if #results >= maxResults then return end
        if depth <= maxDepth then
            if depth > 0 then table.insert(results, {Name=inst.Name, ClassName=inst.ClassName, Path=getFullPath(inst)}) end
            if depth < maxDepth then
                for _, c in ipairs(inst:GetChildren()) do walk(c, depth + 1) end
            end
        end
    end
    walk(root, 0)
    return {success=true, count=#results, instances=results}
end

local function handleHumanoidState(args)
    local path = args.character_path or ""
    local hum
    if path ~= "" then
        local inst, err = resolvePath(path)
        if not inst then return {success=false, error=err} end
        hum = inst:FindFirstChildOfClass("Humanoid")
    elseif LocalPlayer and LocalPlayer.Character then
        hum = LocalPlayer.Character:FindFirstChildOfClass("Humanoid")
    end
    if not hum then return {success=false, error="No Humanoid found"} end
    return {success=true, health=hum.Health, maxHealth=hum.MaxHealth, walkSpeed=hum.WalkSpeed, jumpPower=hum.JumpPower, autoRotate=hum.AutoRotate, useJumpPower=hum.UseJumpPower, sit=hum.Sit, floorMaterial=tostring(hum.FloorMaterial)}
end

local function handleInteractAllPrompts(args)
    local maxPrompts = args.max_prompts or 50
    local scope, err = resolvePath(args.scope or "game:GetService(\"Workspace\")")
    if not scope then return {success=false, error=err} end
    local count = 0
    local function walk(inst)
        if count >= maxPrompts then return end
        if inst:IsA("ProximityPrompt") then pcall(fireproximityprompt, inst); count = count + 1 end
        for _, c in ipairs(inst:GetChildren()) do walk(c) end
    end
    walk(scope)
    return {success=true, count=count}
end

local function handleGuiButtonClick(args)
    local path = args.button_path or ""
    if path ~= "" then
        local inst, err = resolvePath(path)
        if not inst then return {success=false, error=err} end
        local activated = false
        pcall(function() inst:Click() end); activated = true
        if not activated then pcall(function() firesignal(inst.MouseButton1Click) end); activated = true end
        if not activated then pcall(function() firesignal(inst.Activated) end); activated = true end
        return {success=true, buttonPath=path, activated=activated}
    end
    local root = gethui()
    local function findBtn(inst)
        if inst:IsA("TextButton") or inst:IsA("ImageButton") then
            pcall(function() inst:Click() end)
            return {Name=inst.Name, Path=getFullPath(inst)}
        end
        for _, c in ipairs(inst:GetChildren()) do
            local r = findBtn(c)
            if r then return r end
        end
    end
    local btn = findBtn(root)
    if not btn then return {success=false, error="No clickable button found"} end
    return {success=true, button=btn, activated=true}
end

local function handleMouseMove(args)
    local x = args.x or 0; local y = args.y or 0
    if VirtualInputManager then
        pcall(function() VirtualInputManager:SendMouseMoveEvent(x, y, game) end)
        return {success=true, x=x, y=y}
    end
    return {success=false, error="VirtualInputManager not available"}
end

local function handleMouseButton(args)
    local action = args.action or "click"
    local button = Enum.UserInputType.MouseButton1
    if args.button == "right" then button = Enum.UserInputType.MouseButton2
    elseif args.button == "middle" then button = Enum.UserInputType.MouseButton3 end
    if action == "click" then
        if VirtualInputManager then
            pcall(function() VirtualInputManager:SendMouseButtonEvent(0, 0, button, true, game, 0); task.wait(0.03); VirtualInputManager:SendMouseButtonEvent(0, 0, button, false, game, 0) end)
            return {success=true}
        end
        pcall(function() local m = LocalPlayer:GetMouse(); m.Button1Down=true; task.wait(0.05); m.Button1Down=false end)
        return {success=true}
    end
    if action == "hold" then
        if VirtualInputManager then
            pcall(function() VirtualInputManager:SendMouseButtonEvent(0, 0, button, true, game, 0) end)
        end
        return {success=true, holding=true}
    end
    if action == "release" then
        if VirtualInputManager then
            pcall(function() VirtualInputManager:SendMouseButtonEvent(0, 0, button, false, game, 0) end)
        end
        return {success=true, holding=false}
    end
    return {success=false, error="Unknown action"}
end

local function handleScrollWheel(args)
    local scrollX = args.scroll_x or 0; local scrollY = args.scroll_y or 0
    if VirtualInputManager then
        pcall(function() VirtualInputManager:SendScrollWheelEvent(0, 0, scrollX, scrollY, game) end)
        return {success=true}
    end
    return {success=false, error="VirtualInputManager not available"}
end

local function handleKeyHold(args)
    local action = args.action or "press"
    local key = args.key or ""
    if key == "" then return {success=false, error="key required"} end
    local vk = Enum.KeyCode[key]
    if not vk then return {success=false, error="Unknown key: "..key} end
    if VirtualInputManager then
        if action == "press" then
            pcall(function() VirtualInputManager:SendKeyEvent(true, vk, false, game); task.wait(0.03); VirtualInputManager:SendKeyEvent(false, vk, false, game) end)
        elseif action == "hold" then
            pcall(function() VirtualInputManager:SendKeyEvent(true, vk, false, game) end)
        elseif action == "release" then
            pcall(function() VirtualInputManager:SendKeyEvent(false, vk, false, game) end)
        end
        return {success=true, action=action, key=key}
    end
    return {success=false, error="VirtualInputManager not available"}
end

local function handleTextType(args)
    local text = args.text or ""
    if text == "" then return {success=false, error="text required"} end
    if VirtualInputManager then
        for i = 1, #text do
            local char = text:sub(i, i)
            pcall(function()
                for _, v in pairs(Enum.KeyCode:GetEnumItems()) do
                    if v.Name == char or v.Name == "Key"..char then
                        VirtualInputManager:SendKeyEvent(true, v, false, game)
                        task.wait(0.02)
                        VirtualInputManager:SendKeyEvent(false, v, false, game)
                        break
                    end
                end
            end)
            task.wait(0.01)
        end
        return {success=true, typed=#text}
    end
    return {success=false, error="VirtualInputManager not available"}
end

local function handleCameraControl(args)
    local action = args.action or "get"
    local workspaceCam = workspace.CurrentCamera
    if not workspaceCam then return {success=false, error="No camera"} end
    if action == "get" then
        return {success=true, cframe=serialize(workspaceCam.CFrame), focus=serialize(workspaceCam.Focus), fieldOfView=workspaceCam.FieldOfView, cameraType=tostring(workspaceCam.CameraType)}
    end
    if action == "set_cframe" then
        local c = args.cframe or {}
        local cf = c.x and CFrame.new(c.x, c.y or 0, c.z or 0, c.qx or 0, c.qy or 0, c.qz or 0, c.qw or 1) or nil
        if cf then workspaceCam.CFrame = cf end
        return {success=true}
    end
    return {success=false, error="Unknown action"}
end

local function handleScreenText(args)
    local maxText = args.max_results or 50
    local results = {}
    local function scan(inst)
        if #results >= maxText then return end
        if inst:IsA("TextLabel") or inst:IsA("TextButton") or inst:IsA("TextBox") then
            table.insert(results, {Name=inst.Name, Path=getFullPath(inst), text=inst.Text, textColor=tostring(inst.TextColor3), visible=inst.Visible, position=tostring(inst.Position)})
        end
        for _, c in ipairs(inst:GetChildren()) do scan(c) end
    end
    scan(gethui())
    if workspace then scan(workspace) end
    return {success=true, count=#results, texts=results}
end

local function handleNotificationHide()
    pcall(function()
        for _, c in ipairs(gethui():GetDescendants()) do
            if c:IsA("Notification") or c.Name:find("Notification") then c:Destroy() end
        end
    end)
    return {success=true}
end

local function handleESP(args)
    local action = args.action or "toggle"
    local targetClass = args.target_class or "Player"
    local state = args.state
    if state == nil then state = (action == "enable" or action == "toggle") end
    return {success=true, message="ESP requires Drawing lib, check executor support", action=action, class=targetClass, enabled=state}
end

local function handleLightingConfig(args)
    local lighting = game:GetService("Lighting")
    local properties = args.properties or {}
    for k, v in pairs(properties) do
        pcall(function() lighting[k] = v end)
    end
    return {success=true, applied=properties}
end

local function handleTerrainBrush(args)
    local action = args.action or "read"
    local terrain = workspace:FindFirstChildOfClass("Terrain")
    if not terrain then return {success=false, error="No Terrain"} end
    if action == "read" then
        return {success=true, material=tostring(terrain.Material), materialColors={}}
    end
    if action == "fill" and args.material then
        local region = args.region or {-256, 0, -256, 256, 64, 256}
        pcall(function() terrain:FillRegion(Region3.new(Vector3.new(region[1],region[2],region[3]), Vector3.new(region[4],region[5],region[6])), tonumber(args.material) or Enum.Material.Grass) end)
        return {success=true}
    end
    return {success=false, error="Unknown action"}
end

local function handleSoundControl(args)
    local action = args.action or "list"
    if action == "list" then
        local results = {}
        for _, c in ipairs(workspace:GetDescendants()) do
            if c:IsA("Sound") then table.insert(results, {Name=c.Name, Path=getFullPath(c), playing=c.Playing, volume=c.Volume, timeLength=c.TimeLength, soundId=c.SoundId}) end
        end
        return {success=true, count=#results, sounds=results}
    end
    if action == "play" and args.sound_path then
        local inst = resolvePath(args.sound_path)
        if inst then pcall(function() inst:Play() end) end
        return {success=true}
    end
    return {success=false, error="Unknown action"}
end

local function handlePhysicsTune(args)
    local properties = args.properties or {}
    local ws = workspace
    for k, v in pairs(properties) do
        pcall(function() ws[k] = v end)
    end
    return {success=true, applied=properties}
end

local function handleCharacterAppearance(args)
    local action = args.action or "get"
    if not LocalPlayer or not LocalPlayer.Character then return {success=false, error="No character"} end
    if action == "get" then
        local humanoid = LocalPlayer.Character:FindFirstChildOfClass("Humanoid")
        local appearance = {characterName=LocalPlayer.Character.Name, className=LocalPlayer.Character.ClassName}
        if humanoid then
            appearance.displayName = humanoid.DisplayName
            appearance.bodyTypeScale = humanoid.BodyTypeScale
            appearance.widthScale = humanoid.WidthScale
            appearance.heightScale = humanoid.HeightScale
            appearance.headScale = humanoid.HeadScale
        end
        return {success=true, appearance=appearance}
    end
    return {success=false, error="Unknown action"}
end

local function handleSpawnManage(args)
    local action = args.action or "list"
    if action == "list" then
        local sp = {}
        for _, c in ipairs(workspace:GetDescendants()) do
            if c:IsA("SpawnLocation") then table.insert(sp, {Name=c.Name, Path=getFullPath(c), duration=c.Duration, neutral=c.Neutral, allowTeamChange=c.AllowTeamChange, teamColor=tostring(c.TeamColor)}) end
        end
        return {success=true, count=#sp, spawns=sp}
    end
    return {success=false, error="Unknown action"}
end

local function handleChatSystem(args)
    local action = args.action or "say"
    if action == "say" and LocalPlayer then
        local msg = args.message or ""
        if msg ~= "" then
            pcall(function() LocalPlayer:Chat(msg) end)
            return {success=true, message=msg}
        end
    end
    return {success=false, error="Cannot chat"}
end

local function handleTeamColors(args)
    local results = {}
    for _, c in ipairs(workspace:GetDescendants()) do
        if c:IsA("Team") then table.insert(results, {Name=c.Name, color=tostring(c.TeamColor), autoAssignable=c.AutoAssignable}) end
    end
    return {success=true, count=#results, teams=results}
end

local function handleMaterialOverride(args)
    local partPath = args.part_path or ""
    local material = args.material or ""
    if partPath == "" then return {success=false, error="part_path required"} end
    local inst, err = resolvePath(partPath)
    if not inst then return {success=false, error=err} end
    if material ~= "" then
        local matEnum = Enum.Material[material]
        if matEnum then pcall(function() inst.Material = matEnum end) end
    end
    return {success=true, part=inst.Name, material=material}
end

local function handleUiChangeWatcher(args)
    local timeout = args.watch_time or args.duration or 5
    local maxChanges = args.max_events or args.max_changes or 100
    local filterClass = args.filter_class or ""
    local filterName = (args.filter_name or ""):lower()
    local changeTypes = args.change_types or {}
    local propFilters = args.property_filters or {}
    local command = args.command or "start"
    if command ~= "start" then
        return {success=true, message="Only 'start' command supported", changes={}}
    end
    local root = gethui()
    local changes = {}
    local watching = true
    local conns = {}
    local function matchFilter(inst)
        if filterClass ~= "" and inst.ClassName ~= filterClass then return false end
        if filterName ~= "" and not inst.Name:lower():find(filterName, 1, true) then return false end
        return true
    end
    local function shouldTrack(ct)
        if #changeTypes == 0 then return true end
        for _, t in ipairs(changeTypes) do if t == ct then return true end end
        return false
    end
    if shouldTrack("child_added") then
        table.insert(conns, root.DescendantAdded:Connect(function(inst)
            if not watching or #changes >= maxChanges then return end
            if not matchFilter(inst) then return end
            table.insert(changes, {type="child_added", name=inst.Name, className=inst.ClassName, path=getFullPath(inst), timestamp=tick()})
        end))
    end
    if shouldTrack("child_removed") then
        table.insert(conns, root.DescendantRemoving:Connect(function(inst)
            if not watching or #changes >= maxChanges then return end
            if not matchFilter(inst) then return end
            table.insert(changes, {type="child_removed", name=inst.Name, className=inst.ClassName, path=getFullPath(inst), timestamp=tick()})
        end))
    end
    if shouldTrack("property_changed") or shouldTrack("visibility_changed") or shouldTrack("position_changed") or shouldTrack("size_changed") then
        local props = {}
        if shouldTrack("visibility_changed") then table.insert(props, "Visible") end
        if shouldTrack("position_changed") then table.insert(props, "Position") end
        if shouldTrack("size_changed") then table.insert(props, "Size") end
        if shouldTrack("property_changed") then
            for _, p in ipairs(propFilters) do table.insert(props, p) end
            if #props == 0 then props = {"Text", "Visible", "Position", "Size", "BackgroundColor3", "TextColor3", "Image", "Transparency", "Rotation", "ZIndex"} end
        end
        local propConns = {}
        local function scanProps(inst)
            if inst:IsA("GuiObject") then
                for _, pn in ipairs(props) do
                    local ok, sig = pcall(function() return inst:GetPropertyChangedSignal(pn) end)
                    if ok then
                        table.insert(propConns, sig:Connect(function()
                            if not watching or #changes >= maxChanges then return end
                            if not matchFilter(inst) then return end
                            local ok2, val = pcall(function() return inst[pn] end)
                            table.insert(changes, {type="property_changed", name=inst.Name, className=inst.ClassName, path=getFullPath(inst), property=pn, newValue=tostring(ok2 and val or "?"), timestamp=tick()})
                        end))
                    end
                end
            end
        end
        scanProps(root)
        local function scanNew(inst)
            if #changes >= maxChanges then return end
            pcall(function() scanProps(inst) end)
        end
        if not shouldTrack("child_added") then
            table.insert(conns, root.DescendantAdded:Connect(scanNew))
        end
        for _, c in ipairs(propConns) do table.insert(conns, c) end
    end
    local startTime = tick()
    while watching do
        if #changes >= maxChanges then break end
        if tick() - startTime >= timeout then break end
        task.wait(0.1)
    end
    watching = false
    for _, c in ipairs(conns) do pcall(function() c:Disconnect() end) end
    return {success=true, changes=changes, changeCount=#changes, watchedSeconds=tick()-startTime, reachedMax=(#changes >= maxChanges), timedOut=(#changes < maxChanges)}
end

local HANDLERS = {
    get_game_metadata=handleGetMetadata, game_metadata_collector=handleGetMetadata,
    dump_workspace_players=handleDumpPlayers, local_player_state_dumper=handleDumpPlayers,
    get_local_player_data=handlePlayerState,
    dump_remote_events=handleDumpRemotes, remote_surface_scanner=handleDumpRemotes,
    get_console_logs=handleConsoleLog, get_network_ownership=handleNetworkOwnership,
    luau_code_executor=handleCodeExec, execute_custom_luau=handleSandboxExec,
    get_workspace_objects=handleWorkspaceObjects,
    remote_event_trigger=handleRemoteFire, remote_function_caller=handleRemoteFire,
    invoke_remote_function=handleRemoteFire, fire_remote_event=handleRemoteFire,
    remote_connection_inspector=handleRemoteConns, get_remote_connections=handleRemoteConns,
    recursive_tree_walker=function(a)a.action="walk";return handleTreeExplore(a)end,
    service_discoverer=function(a)a.action="services";return handleTreeExplore(a)end,
    child_watcher=function(a)a.action="children";return handleTreeExplore(a)end,
    path_resolver=function(a)a.action="path_resolve";return handleTreeExplore(a)end,
    class_subtree_enumerator=function(a)a.action="subtree";return handleTreeExplore(a)end,
    spatial_proximity_scanner=function(a)a.action="proximity";return handleTreeExplore(a)end,
    fire_click_detector=function(a)a.action="clickdetector";return handleTreeExplore(a)end,
    fire_proximity_prompt=function(a)a.action="proximity_prompt";return handleTreeExplore(a)end,
    tag_collector=function(a)a.action="tag_collect";return handleTreeExplore(a)end,
    attribute_seeker=function(a)a.action="attribute_seek";return handleTreeExplore(a)end,
    nil_realm_scanner=function(a)a.action="nil_realm";return handleTreeExplore(a)end,
    get_nil_instances=function(a)a.action="nil_realm";return handleTreeExplore(a)end,
    class_instance_collector=function(a)a.action="class_collect";return handleTreeExplore(a)end,
    property_bulk_reader=handlePropertyRead, property_deep_dive=handlePropertyRead, class_blueprint_viewer=handlePropertyRead,
    gui_injector=handleGuiInject, inject_gui=handleGuiInject, screen_overlay_renderer=handleGuiInject,
    viewport_capture_handler=handleGuiDump, gui_hierarchy_dumper=handleGuiDump,
    file_reader=function(a)a.action="read";return handleFileOp(a)end,
    file_writer=function(a)a.action="write";return handleFileOp(a)end,
    file_deleter=function(a)a.action="delete";return handleFileOp(a)end,
    file_lister=function(a)a.action="list";return handleFileOp(a)end,
    hidden_property_reader=handleHiddenProp, hidden_property_writer=handleHiddenProp, property_scriptable_toggler=handleHiddenProp,
    modify_local_property=handleStateBypass, teleport_to_target=handleStateBypass,
    key_press_emitter=handleInputSim, mouse_click_simulator=handleInputSim, character_motion_controller=handleInputSim,

    get_loaded_modules=handleGetLoadedModules, module_registry_scanner=handleGetLoadedModules,
    running_scripts_lister=handleRunningScripts,
    script_source_ripper=handleScriptSource, script_decompiler=handleScriptDecompiler,
    script_closure_getter=handleScriptClosure,
    script_hash_calculator=handleScriptHash,
    calling_script_finder=handleCallingScript,
    script_environment_dumper=handleScriptEnv,
    roblox_environment_viewer=handleRobloxEnv,
    sandbox_analyzer=handleSandboxAnalysis,

    namecall_spy=handleNamecallSpy,
    metatable_seer=handleMetatableSeer, metatable_modifier=handleMetatableModifier,
    raw_metatable_setter=function(a)a.action="set_raw";a.new_metatable=a.metatable;return handleMetatableModifier(a)end,
    readonly_toggler=function(a)a.action="set_readonly";a.state=a.state;return handleMetatableModifier(a)end,
    function_interceptor_installer=handleFuncInterceptor, function_interceptor_remover=handleFuncInterceptor,
    function_hook_installer=handleFuncInterceptor,
    closure_type_checker=handleClosureType,

    registry_scanner=handleRegistryScan, registry_reader=handleRegistryScan,
    gc_scanner=handleGCScan,
    closure_inspector=handleClosureInspect,
    closure_upvalue_editor=handleClosureInspect,
    dump_constants_and_upvalues=handleDumpConstants,
    debug_info_extractor=handleDebugInfo,
    module_registry_scanner=handleGetLoadedModules,

    spy_remote_traffic=handleRemoteSpy,
    traffic_interceptor_installer=handleTrafficInterceptor, traffic_interceptor_remover=handleTrafficInterceptor,
    remote_blocker_installer=function(a)a.action="block";return handleTrafficInterceptor(a)end,
    remote_killswitch_toggler=function(a)a.action="block";return handleTrafficInterceptor(a)end,
    argument_spoofer=handleArgSpoofer,
    argument_type_analyzer=handleTrafficInterceptor,
    replication_filter_checker=handleNetworkOwnership,
    traffic_filter_setter=handleTrafficInterceptor,

    instance_comparer=handleInstanceComparer,
    sibling_enumerator=handleSiblingEnum,
    property_value_seeker=handlePropertySeeker,
    data_model_explorer=handleDataModelExplore,
    datamodel_explorer=handleDataModelExplore,
    humanoid_state_extractor=handleHumanoidState,
    interact_all_proximity_prompts=handleInteractAllPrompts,
    gui_button_clicker=handleGuiButtonClick,
    signal_replicator=function(a)if a.signal_path then local inst=resolvePath(a.signal_path);if inst then pcall(firesignal,inst)end;return{success=true}end;return{success=false,error="signal_path required"}end,

    mouse_move_absolute=handleMouseMove,
    mouse_button_hold=handleMouseButton, mouse_drag_emitter=handleMouseButton,
    scroll_wheel_simulator=handleScrollWheel,
    key_hold_controller=handleKeyHold, key_combo_simulator=handleKeyHold,
    text_automated_typer=handleTextType,
    touch_input_simulator=handleMouseMove,
    ui_element_clicker=handleGuiButtonClick,

    camera_state_reader=handleCameraControl, camera_controller=handleCameraControl,
    screen_text_extractor=handleScreenText,
    notification_hider=handleNotificationHide,
    clean_gui_traces=handleNotificationHide,
    cursor_tracker=function()local m=LocalPlayer:GetMouse();return{success=true,x=m.X,y=m.Y}end,
    world_to_screen_converter=function(a)local cam=workspace.CurrentCamera;if not cam then return{success=false,error="No camera"}end;local p=Vector3.new(a.world_x or 0,a.world_y or 0,a.world_z or 0);local ok,sp=pcall(function()return cam:WorldToScreenPoint(p)end);if ok then return{success=true,screenX=sp.X,screenY=sp.Y,onScreen=sp.Z>0}end;return{success=false,error="WorldToScreenPoint failed"}end,
    element_geometry_reader=function(a)local inst=resolvePath(a.instance_path or "");if not inst then return{success=false,error="instance_path required"}end;local ok,cf=pcall(function()return inst:GetBoundingBox()end);if ok then return{success=true,cframe=serialize(cf),size=serialize(inst:GetExtentsSize())}end;return{success=true,path=getFullPath(inst)}end,

    esp_label_manager=handleESP,
    billboard_attachment_manager=handleESP,
    lighting_configurator=handleLightingConfig,
    terrain_brush_controller=handleTerrainBrush,
    sound_effect_manager=handleSoundControl,
    atmosphere_tweaker=handleLightingConfig,
    cloud_fog_controller=handleLightingConfig,
    physics_engine_tuner=handlePhysicsTune,
    character_appearance_modifier=handleCharacterAppearance,
    spawn_location_manager=handleSpawnManage,
    chat_system_controller=handleChatSystem,
    team_color_manager=handleTeamColors,
    material_override_tool=handleMaterialOverride,

    property_mutator_generic=function(a)local inst=resolvePath(a.instance_path or "");if not inst then return{success=false,error="instance_path required"}end;local props=a.properties or {};for k,v in pairs(props)do pcall(function()inst[k]=v end)end;return{success=true,applied=props}end,
    instance_factory=function(a)local cn=a.class_name or "Part";local parent=resolvePath(a.parent_path or "game:GetService(\"Workspace\")");if not parent then return{success=false,error="Parent not found"}end;local ok,ni=pcall(function()local i=Instance.new(cn);local props=a.properties or {};for k,v in pairs(props)do i[k]=v end;i.Parent=parent;return i end);if not ok then return{success=false,error="Create failed: "..tostring(ni)}end;return{success=true,name=ni.Name,path=getFullPath(ni)}end,
    instance_terminator=function(a)local inst=resolvePath(a.instance_path or "");if not inst then return{success=false,error="instance_path required"}end;pcall(function()inst:Destroy()end);return{success=true}end,
    instance_duplicator=function(a)local inst=resolvePath(a.instance_path or "");if not inst then return{success=false,error="instance_path required"}end;local ok,clone=pcall(function()return inst:Clone()end);if not ok then return{success=false,error="Clone failed"}end;local parent=resolvePath(a.parent_path or "");if parent then clone.Parent=parent end;return{success=true,clonedName=clone.Name,clonedPath=a.parent_path~="" and getFullPath(clone) or "unparented"}end,

    folder_creator=function(a)local p=a.path or "";if p=="" then return{success=false,error="path required"}end;pcall(makefolder,p);return{success=true,path=p}end,
    custom_asset_loader=function(a)local p=a.path or "";if p=="" then return{success=false,error="path required"}end;local ok,asset=pcall(getcustomasset,p);if ok then return{success=true,assetPath=asset}end;return{success=false,error="getcustomasset failed"}end,

    bytecode_disassembler=handleScriptSource,
    runtime_bytecode_patcher=handleScriptSource,
    response_interceptor=handleRemoteSpy,

    value_container_scanner=handlePropertySeeker,
    object_value_resolver=handlePropertySeeker,
    attribute_collector=handleTreeExplore, full_attribute_enumerator=handleTreeExplore,
    string_value_reader=handlePropertyRead, tag_reader=handleTreeExplore,
    security_metadata_analyzer=handlePropertyRead,
    check_unc_capabilities=function()return{success=true,capabilities=MCP_CAPABILITIES}end,
    macro_recorder=function()return{success=true,message="Macro recorder not implemented in executor"}end,
    macro_replayer=function()return{success=true,message="Macro replayer not implemented in executor"}end,

    get_instance_from_path=function(a)a.action="path_resolve";return handleTreeExplore(a)end,
    network_ownership_mapper=handleNetworkOwnership,
    traffic_interceptor_remover=function(a)a.action="remove";return handleTrafficInterceptor(a)end,
    function_interceptor_remover=function(a)a.action="remove";return handleFuncInterceptor(a)end,
    mouse_drag_emitter=function(a)a.action="hold";return handleMouseButton(a)end,
    key_combo_simulator=function(a)a.key=(a.keys or {})[1] or "";return handleKeyHold(a)end,
    ui_change_watcher=handleUiChangeWatcher,
}

proxyToServer = function(toolName, args)
    return {success=false, error="Feature '"..tostring(toolName).."' is not handled by this executor. The executor's HttpService:PostAsync is blocked and no local handler was registered.", tool=toolName}
end

print("[MCP] Starting: " .. WS_URL)
local lastPing = tick()
local lastPong = tick()
local PONG_TIMEOUT = 8
while true do
    if not WS_CONNECTED or not WS then
        print("[MCP] Connecting...")
        local ok, err = pcall(wsReconnect)
        if ok then
            print("[MCP] Connected | Worker: " .. WORKER_ID)
            lastPong = tick()
        else
            print("[MCP] Connect failed: " .. tostring(err) .. " (retry in " .. RECONNECT_DELAY .. "s)")
            task.wait(RECONNECT_DELAY)
        end
    end
    if WS_CONNECTED and WS and tick() - lastPing >= 1 then
        lastPing = tick()
        pcall(function() WS:Send(HttpService:JSONEncode({type="ping"})) end)
    end
    local tsk = wsPoll()
    if not tsk then
        task.wait(0.1)
    else
        local handler = HANDLERS[tsk.type]
        local resultData
        if not handler then
            resultData = proxyToServer(tsk.type, tsk.args or {})
        else
            local ok2, res = pcall(handler, tsk.args or {})
            if ok2 then resultData = res else resultData = {success=false,error="Handler: "..tostring(res)} end
        end
        pcall(wsSend, tsk.id, resultData, nil, tsk.pid)
    end
    if WS_CONNECTED and WS and tick() - lastPong >= PONG_TIMEOUT then
        print("[MCP] No pong for " .. PONG_TIMEOUT .. "s, WebSocket dead")
        WS = nil; WS_CONNECTED = false
    end
end