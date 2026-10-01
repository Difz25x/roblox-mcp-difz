// ==========================================================================
// ROBLOX MCP COMMAND DECK — DATAMATICS CONTROLLER
// High-Performance Event-Driven Operations Engine
// ==========================================================================

const PORT = parseInt(window.PORT || location.port || '28429', 10);
let allTools = [];
let selectedCategory = 'all';
let selectedToolName = '';
let activeProcesses = [];
let pollTimer = null;
let currentUptimeSec = 0;

// ==========================================================================
// TACTICAL TOAST SYSTEM
// ==========================================================================
function notify(msg) {
    const el = document.getElementById('deck-toast');
    if (!el) return;
    el.innerText = msg;
    el.classList.add('show');
    clearTimeout(el._hideTimeout);
    el._hideTimeout = setTimeout(() => {
        el.classList.remove('show');
    }, 2200);
}

// ==========================================================================
// NAVIGATION & VIEW SWITCHING
// ==========================================================================
function switchView(tabId) {
    document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));

    const targetView = document.getElementById('view-' + tabId);
    const targetBtn = document.getElementById('nav-btn-' + tabId);

    if (targetView) targetView.classList.add('active');
    if (targetBtn) targetBtn.classList.add('active');

    if (tabId === 'port-sync') {
        loadPortConfig();
    } else if (tabId === 'unc') {
        loadUncMatrix();
    }
}

// ==========================================================================
// TELEMETRY REFRESH
// ==========================================================================
async function fetchTelemetry() {
    try {
        const res = await fetch('/health');
        if (!res.ok) throw new Error('Health check error');
        const data = await res.json();

        // 1. Roblox Processes KPI
        const totalProcs = data.robloxProcesses ? data.robloxProcesses.total : 0;
        const connectedProcs = data.robloxProcesses && data.robloxProcesses.status ? data.robloxProcesses.status.connected : 0;
        const standbyProcs = Math.max(0, totalProcs - connectedProcs);

        const elProcTotal = document.getElementById('kpi-proc-total');
        const elProcSplit = document.getElementById('kpi-proc-split');
        if (elProcTotal) elProcTotal.innerText = totalProcs;
        if (elProcSplit) elProcSplit.innerText = `${connectedProcs} CONNECTED / ${standbyProcs} STANDBY`;

        // 2. Active Workers KPI
        const elWorkers = document.getElementById('kpi-workers');
        const elTransportSplit = document.getElementById('kpi-transport-split');
        if (elWorkers) elWorkers.innerText = data.activeSessions || 0;
        if (elTransportSplit) elTransportSplit.innerText = `${data.wsConnections || 0} WS ACTIVE`;

        // 3. Tool Registry KPI
        const elTools = document.getElementById('kpi-tools');
        if (elTools && data.toolsRegistered) elTools.innerText = data.toolsRegistered;

        // 4. System Throughput & Uptime
        const elProcessed = document.getElementById('kpi-processed');
        const elUptime = document.getElementById('kpi-uptime');
        if (elProcessed) elProcessed.innerText = data.totalProcessed || 0;
        if (elUptime && data.uptime !== undefined) {
            currentUptimeSec = data.uptime;
            const m = Math.floor(currentUptimeSec / 60);
            const s = Math.floor(currentUptimeSec % 60);
            elUptime.innerText = `UPTIME: ${m}m ${s}s`;
        }

        // 5. Header Status Indicator
        const statusChip = document.getElementById('brand-status-chip');
        if (statusChip) {
            statusChip.className = 'brand-status-chip online';
            statusChip.innerText = 'ONLINE';
        }
    } catch {
        const statusChip = document.getElementById('brand-status-chip');
        if (statusChip) {
            statusChip.className = 'brand-status-chip offline';
            statusChip.innerText = 'OFFLINE';
        }
    }
}

// ==========================================================================
// VIEW 1: PROCESS MONITOR & INSTANCE CONTROLS
// ==========================================================================
async function loadProcesses() {
    try {
        const res = await fetch('/api/processes');
        const data = await res.json();
        const container = document.getElementById('instances-table-body');
        const countBadge = document.getElementById('instances-count-badge');
        if (!container) return;

        const list = data.processes || [];
        activeProcesses = list;
        if (countBadge) countBadge.innerText = `${list.length} WINDOWS`;

        if (list.length === 0) {
            container.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align:center; padding: 2.5rem 1rem;">
                        <div class="empty-data-box">
                            <div class="empty-data-title">NO ROBLOX PROCESSES DETECTED</div>
                            <div class="empty-data-desc">
                                No active Roblox Player or Studio client was detected on this system. Launch Roblox to establish an automated MCP worker session.
                            </div>
                            <button class="btn btn-invert btn-sm" onclick="launchRoblox()">+ LAUNCH ROBLOX CLIENT</button>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        container.innerHTML = list.map(p => `
            <tr>
                <td style="font-weight:700; color:#fff;">PID ${p.pid}</td>
                <td>${p.windowTitle || p.name || 'Roblox Window'}</td>
                <td>
                    <span class="badge-state ${p.status === 'connected' ? 'connected' : 'standby'}">
                        ${p.status === 'connected' ? 'CONNECTED' : 'STANDBY'}
                    </span>
                </td>
                <td style="font-family:var(--font-mono);">${p.memoryMB ? p.memoryMB + ' MB' : 'N/A'}</td>
                <td style="font-size:10px; color:var(--text-muted);">${(p.transport || 'AUTO').toUpperCase()}</td>
                <td style="text-align:right;">
                    <div style="display:inline-flex; gap:4px;">
                        <button class="btn btn-sm" onclick="captureWindowScreenshot(${p.pid})">SCREENSHOT</button>
                        <button class="btn btn-sm btn-danger" onclick="killPid(${p.pid})">KILL</button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Process list fetch error:', err);
    }
}

async function launchRoblox() {
    notify('LAUNCHING ROBLOX CLIENT...');
    try {
        const res = await fetch('/api/processes/launch', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            notify(`ROBLOX INITIATED (PID ${data.pid || 'ACTIVE'})`);
            setTimeout(loadProcesses, 1600);
        } else {
            notify(`LAUNCH FAILED: ${data.error || 'UNKNOWN'}`);
        }
    } catch (err) {
        notify('LAUNCH ERROR: ' + err.message);
    }
}

async function killPid(pid) {
    if (!confirm(`Confirm termination of Roblox process PID ${pid}?`)) return;
    try {
        const res = await fetch('/api/processes/kill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pid })
        });
        const data = await res.json();
        if (data.success) {
            notify(`PID ${pid} TERMINATED`);
            loadProcesses();
        } else {
            notify(`TERMINATE FAILED: ${data.error || 'UNKNOWN'}`);
        }
    } catch (err) {
        notify('KILL ERROR: ' + err.message);
    }
}

async function captureWindowScreenshot(pid) {
    notify(`CAPTURING WINDOW PID ${pid}...`);
    try {
        const res = await fetch('/api/tools/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'take-screenshot', arguments: { pid } })
        });
        const data = await res.json();
        let payload = data.result || data;
        if (payload.content && payload.content[0] && payload.content[0].text) {
            try { payload = JSON.parse(payload.content[0].text); } catch {}
        }

        const stage = document.getElementById('screenshot-stage');
        const frame = document.getElementById('screenshot-frame');
        const meta = document.getElementById('screenshot-meta-tag');

        if (stage && frame && payload.image) {
            frame.innerHTML = `<img src="${payload.image}" alt="Roblox Window Capture PID ${pid}" style="max-width:100%; height:auto; display:block;">`;
            if (meta) meta.innerText = `PID ${pid} • ${new Date().toLocaleTimeString()}`;
            stage.classList.add('open');
            stage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            notify('SCREENSHOT RENDERED');
        } else if (payload.file_path) {
            notify(`SAVED TO: ${payload.file_path}`);
        } else {
            notify(payload.error || 'SCREENSHOT CAPTURED');
        }
    } catch (err) {
        notify('SCREENSHOT ERROR: ' + err.message);
    }
}

function closeScreenshotStage() {
    const stage = document.getElementById('screenshot-stage');
    if (stage) stage.classList.remove('open');
    const frame = document.getElementById('screenshot-frame');
    if (frame) frame.innerHTML = '<div style="color:var(--text-muted); font-size:12px; padding:2rem;">NO ACTIVE CAPTURE</div>';
}

// ==========================================================================
// VIEW 2: TOOLS DIRECTORY & INTERACTIVE EXECUTION
// ==========================================================================
async function loadTools() {
    try {
        const res = await fetch('/api/tools');
        const data = await res.json();
        allTools = data.tools || [];

        const elHeaderCount = document.getElementById('tools-total-count');
        const elAllPill = document.getElementById('cnt-cat-all');
        if (elHeaderCount) elHeaderCount.innerText = allTools.length;
        if (elAllPill) elAllPill.innerText = allTools.length;

        // Populate Category counts
        const catMap = {};
        allTools.forEach(t => {
            const c = (t.category || 'other').toLowerCase();
            catMap[c] = (catMap[c] || 0) + 1;
        });

        Object.keys(catMap).forEach(cat => {
            const el = document.getElementById('cnt-cat-' + cat);
            if (el) el.innerText = catMap[cat];
        });

        if (allTools.length > 0 && !selectedToolName) {
            selectedToolName = allTools[0].name;
        }

        renderToolsList();
    } catch (err) {
        console.error('Tools list fetch error:', err);
    }
}

function setCategoryFilter(cat) {
    selectedCategory = cat;
    document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
    const activePill = document.getElementById('pill-cat-' + cat);
    if (activePill) activePill.classList.add('active');
    renderToolsList();
}

function filterTools() {
    renderToolsList();
}

function renderToolsList() {
    const container = document.getElementById('tools-list-container');
    if (!container) return;

    const query = (document.getElementById('tool-search-input')?.value || '').toLowerCase().trim();

    const filtered = allTools.filter(t => {
        const cat = (t.category || 'other').toLowerCase();
        const matchesCategory = (selectedCategory === 'all') || (cat === selectedCategory);
        if (!matchesCategory) return false;
        if (!query) return true;
        const matchesName = t.name.toLowerCase().includes(query);
        const matchesDesc = (t.description || '').toLowerCase().includes(query);
        return matchesName || matchesDesc;
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div style="padding: 2rem 1rem; text-align: center; color: var(--text-muted); font-size: 12px;">
                NO TOOLS MATCHING "${query}"
            </div>
        `;
        return;
    }

    const hasSelected = filtered.some(t => t.name === selectedToolName);
    if (!hasSelected) {
        selectedToolName = filtered[0].name;
    }

    container.innerHTML = filtered.map(t => {
        const isSelected = t.name === selectedToolName;
        return `
            <div class="tool-entry-row ${isSelected ? 'active' : ''}" onclick="selectTool('${t.name}')">
                <div class="tool-entry-header">
                    <span class="tool-entry-name">${t.name}</span>
                    <span class="tool-entry-cat">${t.category || 'tool'}</span>
                </div>
                <div class="tool-entry-desc">${t.description || ''}</div>
            </div>
        `;
    }).join('');

    renderToolDetail(selectedToolName);
}

function selectTool(name) {
    selectedToolName = name;
    document.querySelectorAll('.tool-entry-row').forEach(r => r.classList.remove('active'));
    renderToolsList();
}

function renderToolDetail(name) {
    const container = document.getElementById('tool-inspector-panel');
    if (!container) return;

    const tool = allTools.find(t => t.name === name);
    if (!tool) {
        container.innerHTML = `
            <div class="empty-data-box">
                <div class="empty-data-title">NO TOOL SELECTED</div>
                <div class="empty-data-desc">Choose a tool from the directory to inspect arguments and execute.</div>
            </div>
        `;
        return;
    }

    const schema = tool.inputSchema || {};
    const props = schema.properties || {};
    const reqList = schema.required || [];
    const propKeys = Object.keys(props);

    // Build sample JSON-RPC 2.0 object
    const sampleArgs = {};
    propKeys.forEach(k => {
        if (k === 'workerId') sampleArgs[k] = 'Worker_11420';
        else if (k === 'pid') sampleArgs[k] = activeProcesses[0]?.pid || 11420;
        else if (props[k].type === 'boolean') sampleArgs[k] = true;
        else if (props[k].type === 'number') sampleArgs[k] = 100;
        else if (props[k].type === 'array') sampleArgs[k] = ['element_1'];
        else sampleArgs[k] = props[k].description || 'sample_value';
    });

    const mcpSampleJson = JSON.stringify({
        name: tool.name,
        arguments: sampleArgs
    }, null, 2);

    container.innerHTML = `
        <div class="detail-head-banner">
            <div class="detail-title-line">
                <div class="detail-tool-name">${tool.name}</div>
                <div class="detail-badge-group">
                    <span class="detail-badge active">${tool.category || 'GENERAL'}</span>
                    <span class="detail-badge">JSON-RPC 2.0</span>
                    <span class="detail-badge">MULTI-SESSION</span>
                </div>
            </div>
            <div class="detail-description">${tool.description || 'No tool description provided.'}</div>
        </div>

        <!-- MCP Tool Call Schema & Signature -->
        <div>
            <div class="param-section-title">AI MCP Call Schema</div>
            <div class="terminal-code-box">
                <div class="terminal-code-head">
                    <span>CALL SPECIFICATION (JSON)</span>
                    <button class="btn btn-sm" onclick="copySnippetText('code-spec-${tool.name}')">COPY JSON</button>
                </div>
                <pre class="terminal-code-body" id="code-spec-${tool.name}">${mcpSampleJson}</pre>
            </div>
        </div>

        <!-- Parameter Table -->
        <div>
            <div class="param-section-title">Parameters &amp; Arguments (${propKeys.length})</div>
            <div class="param-grid-table">
                ${propKeys.length === 0 ? `
                    <div style="padding:1rem; color:var(--text-muted); font-size:12px;">
                        This tool accepts no additional arguments.
                    </div>
                ` : propKeys.map(k => {
                    const p = props[k];
                    const isReq = reqList.includes(k);
                    const typeLabel = (p.type || 'any').toUpperCase();

                    return `
                        <div class="param-grid-row">
                            <div class="param-meta-col">
                                <span class="param-name-label">${k}</span>
                                <span class="param-type-label">${typeLabel} ${isReq ? '• REQUIRED' : '• OPTIONAL'}</span>
                                ${k === 'pid' && activeProcesses.length > 0 ? `
                                    <div class="quick-chip-row">
                                        ${activeProcesses.map(proc => `
                                            <button type="button" class="quick-chip" onclick="document.getElementById('param-inp-${tool.name}-pid').value = '${proc.pid}'">
                                                PID ${proc.pid}
                                            </button>
                                        `).join('')}
                                    </div>
                                ` : ''}
                                ${k === 'workerId' && activeProcesses.some(proc => proc.workerId) ? `
                                    <div class="quick-chip-row">
                                        ${activeProcesses.filter(proc => proc.workerId).map(proc => `
                                            <button type="button" class="quick-chip" onclick="document.getElementById('param-inp-${tool.name}-workerId').value = '${proc.workerId}'">
                                                ${proc.workerId}
                                            </button>
                                        `).join('')}
                                    </div>
                                ` : ''}
                            </div>
                            <div class="param-desc-col">${p.description || '-'}</div>
                            <div class="param-input-col">
                                <input type="text" id="param-inp-${tool.name}-${k}" placeholder="Enter ${k}...">
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>

        <!-- Execution Control Deck -->
        <div>
            <div class="param-section-title">Live Execution Terminal</div>
            <div class="exec-control-bar">
                <button class="btn btn-invert" id="btn-exec-${tool.name}" onclick="executeTool('${tool.name}')">
                    <span>► EXECUTE ${tool.name.toUpperCase()}</span>
                </button>
                <div class="exec-meta-status" id="exec-status-${tool.name}">
                    <span>READY FOR DISPATCH</span>
                </div>
                <button class="btn btn-sm" onclick="clearTerminal('${tool.name}')">CLEAR OUTPUT</button>
            </div>
            <pre class="output-terminal" id="terminal-out-${tool.name}">// Ready for dispatch. Click [EXECUTE ${tool.name.toUpperCase()}] to submit query over active session...</pre>
        </div>
    `;
}

async function executeTool(name) {
    const tool = allTools.find(t => t.name === name);
    if (!tool) return;

    const outBox = document.getElementById('terminal-out-' + name);
    const statusBox = document.getElementById('exec-status-' + name);
    const btn = document.getElementById('btn-exec-' + name);

    if (outBox) outBox.innerText = '// DISPATCHING TO MCP QUEUE...';
    if (statusBox) statusBox.innerHTML = '<span style="color:#ffffff;">PROCESSING TASK...</span>';

    const props = (tool.inputSchema && tool.inputSchema.properties) ? tool.inputSchema.properties : {};
    const args = {};

    Object.keys(props).forEach(k => {
        const inp = document.getElementById(`param-inp-${name}-${k}`);
        if (inp && inp.value.trim() !== '') {
            let val = inp.value.trim();
            if (val === 'true') val = true;
            else if (val === 'false') val = false;
            else if (/^\d+$/.test(val) && props[k].type === 'number') val = parseInt(val, 10);
            else if (val.startsWith('{') || val.startsWith('[')) {
                try { val = JSON.parse(val); } catch {}
            }
            args[k] = val;
        }
    });

    const startTime = performance.now();
    try {
        const res = await fetch('/api/tools/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, arguments: args })
        });
        const elapsed = Math.round(performance.now() - startTime);
        const data = await res.json();

        let display = data.result || data;
        if (display.content && display.content[0] && display.content[0].text) {
            try { display = JSON.parse(display.content[0].text); } catch { display = display.content[0].text; }
        }

        if (outBox) {
            outBox.innerText = `// STATUS: 200 OK | COMPLETED IN ${elapsed}ms\n` + (typeof display === 'string' ? display : JSON.stringify(display, null, 2));
        }
        if (statusBox) statusBox.innerHTML = `<span>COMPLETED (${elapsed}ms)</span>`;
        notify(`${name} EXECUTED (${elapsed}ms)`);
    } catch (err) {
        if (outBox) outBox.innerText = `// EXECUTION ERROR: ${err.message}`;
        if (statusBox) statusBox.innerHTML = `<span style="color:#ffffff;">FAILED</span>`;
        notify('EXECUTION ERROR: ' + err.message);
    }
}

function clearTerminal(name) {
    const outBox = document.getElementById('terminal-out-' + name);
    if (outBox) outBox.innerText = '// Console output cleared.';
}

function copySnippetText(elemId) {
    const el = document.getElementById(elemId);
    if (!el) return;
    navigator.clipboard.writeText(el.innerText).then(() => {
        notify('SNIPPET COPIED TO CLIPBOARD');
    }).catch(() => {
        prompt('Copy snippet:', el.innerText);
    });
}

// ==========================================================================
// VIEW 3: CUSTOM PORT & DISCOVERY ROUTER SYNC
// ==========================================================================
async function loadPortConfig() {
    try {
        const res = await fetch('/api/config/port');
        const data = await res.json();

        const elCur = document.getElementById('stat-cur-port');
        const elDisc = document.getElementById('stat-disc-port');
        const elSaved = document.getElementById('stat-saved-port');
        const elInp = document.getElementById('input-custom-port');

        if (elCur) elCur.innerText = data.currentPort;
        if (elDisc) elDisc.innerText = `${data.discoveryPort} (FIXED ROUTER)`;
        if (elSaved) elSaved.innerText = data.savedPort ? data.savedPort : '(DEFAULT)';
        if (elInp && !elInp.value) elInp.value = data.currentPort;

        // Snippets
        const snipDirect = document.getElementById('code-direct-loader');
        const snipDisc = document.getElementById('code-disc-loader');
        const snipCli = document.getElementById('code-cli-cmd');

        if (snipDirect) snipDirect.innerText = `loadstring(game:HttpGet("http://127.0.0.1:${data.currentPort}/mcp.lua"))()`;
        if (snipDisc) snipDisc.innerText = `loadstring(game:HttpGet("http://127.0.0.1:${data.discoveryPort || 58295}/mcp.lua"))()`;
        if (snipCli) snipCli.innerText = `rblx-mcp start --port ${data.currentPort}`;
    } catch (err) {
        console.error('Load port config error:', err);
    }
}

async function checkPortAvailability() {
    const inp = document.getElementById('input-custom-port');
    const out = document.getElementById('port-check-status');
    if (!inp || !out) return;

    const portNum = parseInt(inp.value.trim(), 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        out.innerHTML = '<span style="color:#ffffff;">INVALID PORT RANGE (1-65535)</span>';
        return;
    }

    out.innerHTML = '<span style="color:var(--text-muted);">CHECKING PORT ACCESSIBILITY...</span>';
    try {
        const res = await fetch('/api/config/port-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port: portNum })
        });
        const data = await res.json();
        if (data.available) {
            out.innerHTML = `<span style="color:#ffffff; font-weight:700;">PORT ${portNum} IS FREE &amp; AVAILABLE</span>`;
        } else {
            out.innerHTML = `<span style="color:var(--text-secondary); font-weight:700;">PORT ${portNum} IS CURRENTLY IN USE</span>`;
        }
    } catch (err) {
        out.innerHTML = `<span style="color:var(--text-muted);">CHECK ERROR: ${err.message}</span>`;
    }
}

async function savePreferredPort() {
    const inp = document.getElementById('input-custom-port');
    if (!inp) return;
    const portNum = parseInt(inp.value.trim(), 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        notify('ENTER A VALID PORT NUMBER (1-65535)');
        return;
    }

    try {
        const res = await fetch('/api/config/port-save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port: portNum })
        });
        const data = await res.json();
        if (data.success) {
            notify(`DEFAULT PORT SAVED AS ${portNum}`);
            loadPortConfig();
        } else {
            notify(`SAVE ERROR: ${data.error}`);
        }
    } catch (err) {
        notify('SAVE FAILED: ' + err.message);
    }
}

// ==========================================================================
// VIEW 4: UNC MATRIX AUDIT
// ==========================================================================
async function loadUncMatrix() {
    try {
        const res = await fetch('/api/unc');
        const data = await res.json();
        const container = document.getElementById('unc-matrix-cells');
        const countTag = document.getElementById('unc-count-tag');
        const execTag = document.getElementById('unc-executor-badge');

        const list = data.standardFunctions || [];
        if (countTag) countTag.innerText = `${list.length} FUNCTIONS`;
        if (execTag && data.capabilities) {
            execTag.innerText = `EXECUTOR: ${data.capabilities.executorName || 'AUTO-DETECT'} (${data.capabilities.supported || 0}/${data.capabilities.total || list.length})`;
        }

        if (container) {
            container.innerHTML = list.map(item => `
                <div class="unc-cell">
                    <div class="unc-cell-head">
                        <span class="unc-func-name">${item.name}</span>
                        <span class="unc-func-cat">${item.category}</span>
                    </div>
                    <div class="unc-func-desc">${item.desc}</div>
                    <div class="unc-fallback-meta">FALLBACK: ${item.fallback}</div>
                </div>
            `).join('');
        }
    } catch (err) {
        console.error('UNC matrix fetch error:', err);
    }
}

// ==========================================================================
// VIEW 5: OPERATIONS & SERVER CONTROL
// ==========================================================================
async function setTransportMode(mode) {
    notify(`SWITCHING TRANSPORT TO ${mode.toUpperCase()}...`);
    try {
        const res = await fetch('/api/transport', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode })
        });
        const data = await res.json();
        if (data.success) {
            notify(`TRANSPORT ACTIVE: ${mode.toUpperCase()}`);
            const chip = document.getElementById('active-transport-chip');
            if (chip) chip.innerText = mode.toUpperCase();
        }
    } catch (err) {
        notify('TRANSPORT ERROR: ' + err.message);
    }
}

async function toggleAutoexecute() {
    try {
        const res = await fetch('/api/autoexecute', { method: 'POST' });
        const data = await res.json();
        const stateStr = data.enabled ? 'ACTIVE' : 'DISABLED';
        notify(`TELEPORT PERSISTENCE: ${stateStr}`);
        const chip = document.getElementById('quick-autoexec-chip');
        if (chip) chip.innerText = stateStr;
    } catch (err) {
        notify('AUTOEXEC ERROR: ' + err.message);
    }
}

async function shutdownServer() {
    if (!confirm('CONFIRM SERVER SHUTDOWN: Terminate active daemon and close all client WebSockets?')) return;
    try {
        await fetch('/stop', { method: 'POST' });
        notify('SERVER SHUTTING DOWN...');
        setTimeout(() => location.reload(), 1500);
    } catch {
        notify('SHUTDOWN SIGNAL TRANSMITTED');
    }
}

// ==========================================================================
// MODAL & LOADER INJECTION ACTIONS
// ==========================================================================
function openLoaderModal() {
    const modal = document.getElementById('loader-modal');
    if (modal) modal.classList.add('open');
}

function closeLoaderModal(e) {
    if (e && e.target && e.target !== e.currentTarget && !e.target.closest('.modal-close-btn')) {
        return;
    }
    const modal = document.getElementById('loader-modal');
    if (modal) modal.classList.remove('open');
}

function copyLoader(type) {
    let code = '';
    if (type === 'discovery') {
        code = 'loadstring(game:HttpGet("http://127.0.0.1:58295/mcp.lua"))()';
    } else {
        code = `loadstring(game:HttpGet("http://127.0.0.1:${PORT}/mcp.lua"))()`;
    }

    navigator.clipboard.writeText(code).then(() => {
        notify(`${type === 'discovery' ? 'AUTO-SYNC' : 'DIRECT'} LOADER COPIED`);
        closeLoaderModal();
    }).catch(() => {
        prompt('Copy snippet:', code);
    });
}

// ==========================================================================
// KEYBOARD COMMAND DISPATCHER
// ==========================================================================
window.addEventListener('keydown', (e) => {
    // Escape closes modals and screenshot stage
    if (e.key === 'Escape') {
        closeLoaderModal();
        closeScreenshotStage();
        return;
    }

    // Skip if focused inside an active input or textarea
    const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    if (activeTag === 'input' || activeTag === 'textarea') return;

    if (e.key === '/') {
        e.preventDefault();
        switchView('tools');
        setTimeout(() => document.getElementById('tool-search-input')?.focus(), 40);
    } else if (e.key === '1') {
        switchView('instances');
    } else if (e.key === '2') {
        switchView('tools');
    } else if (e.key === '3') {
        switchView('port-sync');
    } else if (e.key === '4') {
        switchView('unc');
    } else if (e.key === '5') {
        switchView('settings');
    } else if (e.key.toLowerCase() === 'l') {
        openLoaderModal();
    } else if (e.key.toLowerCase() === 'r') {
        loadProcesses();
        fetchTelemetry();
        notify('DATA REFRESHED');
    }
});

// ==========================================================================
// SYSTEM BOOTSTRAP
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
    fetchTelemetry();
    loadProcesses();
    loadTools();
    loadPortConfig();

    // 2-second continuous polling cadence
    pollTimer = setInterval(() => {
        fetchTelemetry();
        loadProcesses();
    }, 2000);
});
