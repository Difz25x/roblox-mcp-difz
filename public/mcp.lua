if not game:IsLoaded() then game.Loaded:Wait() end
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

-- WS only -- no HTTP fallback
local WS, WS_CONNECTED, WS_BUFFER = nil, false, {}
local function wsConnect()
    local connectFn = (typeof(WebSocket)=="table" and WebSocket.connect) or nil
    if not connectFn then error("No WebSocket support") end
    local ok,s = pcall(connectFn, WS_URL)
    if not ok or not s then error("WS connect failed: " .. tostring(s)) end
    WS=s; WS_CONNECTED=true
    local reg = HttpService:JSONEncode({
        type="register", worker_id=WORKER_ID,
        username=LocalPlayer and LocalPlayer.Name or "Unknown",
        userId=LocalPlayer and LocalPlayer.UserId or 0,
        placeId=game.PlaceId, jobId=game.JobId
    })
    local sent=pcall(function() WS:Send(reg) end)
    if not sent then WS_CONNECTED=false; WS=nil; error("WS register failed") end
    WS.OnMessage:Connect(function(msg)
        print("[MCP] >> " .. msg)
        local ok,d=pcall(function() return HttpService:JSONDecode(msg) end)
        if ok and d and d.type=="task" then table.insert(WS_BUFFER,d) end
    end)
    WS.OnClose:Connect(function() WS_CONNECTED=false end)
    return true
end
local function wsPoll()
    if not WS_CONNECTED or not WS then return nil end
    if #WS_BUFFER>0 then local m=table.remove(WS_BUFFER,1); return {type=m.tool,id=m.id,args=m.args or {}} end
    return nil
end
local function wsSend(id,data,err)
    if not WS_CONNECTED or not WS then return false end
    local payload = HttpService:JSONEncode({type="result",id=id,data=data,error=err})
    print("[MCP] << " .. payload)
    return pcall(function() WS:Send(payload) end)
end

-- Task handlers
local function handleGetMetadata(args)
    local data={PlaceId=game.PlaceId,GameId=game.GameId,JobId=game.JobId,CreatorId=game.CreatorId,CreatorType=tostring(game.CreatorType),Name=game.Name,PlayerCount=#Players:GetPlayers(),MaxPlayers=Players.MaxPlayers,ServerTime=tick()}
    if args.include_performance then data.FPS=1/(RunService.Heartbeat:Wait() or 0.016); data.Memory=collectgarbage("count") end
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

-- Proxy tool call to MCP server via HTTP
local function proxyToServer(toolName, args)
    local body = HttpService:JSONEncode({
        jsonrpc="2.0", id=WORKER_ID, method="tools/call",
        params={name=toolName, arguments=args}
    })
    local ok, r = pcall(function()
        return HttpService:PostAsync("http://"..HOST..":"..PORT.."/mcp", body, Enum.ContentType.ApplicationJson, false)
    end)
    if not ok then return {success=false, error="Server proxy failed: "..tostring(r)} end
    local ok2, d = pcall(function() return HttpService:JSONDecode(r) end)
    if not ok2 then return {success=false, error="Server proxy decode failed"} end
    -- Extract content from MCP response
    if d and d.result and d.result.content and #d.result.content>0 then
        local ok3, parsed = pcall(function() return HttpService:JSONDecode(d.result.content[1].text) end)
        if ok3 then return parsed end
        return {success=true, result=d.result.content[1].text}
    end
    if d and d.error then return {success=false, error="Server error: "..tostring(d.error.message)} end
    return {success=true, data=d}
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
}

-- Main: WS only
print("[MCP] Connecting to " .. WS_URL)
local ok, err = pcall(wsConnect)
if not ok then
    print("[MCP] Failed: " .. tostring(err))
    return
end
print("[MCP] Connected | Worker: " .. WORKER_ID)

while true do
    local tsk = wsPoll()
    if not tsk then
        task.wait(0.05)
    else
        local handler = HANDLERS[tsk.type]
        local resultData
        if not handler then
            resultData = proxyToServer(tsk.type, tsk.args or {})
        else
            local ok2, res = pcall(handler, tsk.args or {})
            if ok2 then resultData = res else resultData = {success=false,error="Handler: "..tostring(res)} end
        end
        pcall(wsSend, tsk.id, resultData, nil)
    end
end
