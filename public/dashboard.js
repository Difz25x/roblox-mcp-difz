
const PORT = parseInt(window.PORT || location.port || '28429', 10);
let allTools = [];
let selectedCategory = 'all';
let selectedToolName = '';
let activeProcesses = [];
let pollTimer = null;
let currentUptimeSec = 0;

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
    } else if (tabId === 'debug') {
        loadDebugSessions(true);
        fetchDebugStatus();
    }
}

async function fetchTelemetry() {
    try {
        const res = await fetch('/health');
        if (!res.ok) throw new Error('Health check error');
        const data = await res.json();

        const totalProcs = data.robloxProcesses ? data.robloxProcesses.total : 0;
        const connectedProcs = data.robloxProcesses && data.robloxProcesses.status ? data.robloxProcesses.status.connected : 0;
        const standbyProcs = Math.max(0, totalProcs - connectedProcs);

        const elProcTotal = document.getElementById('kpi-proc-total');
        const elProcSplit = document.getElementById('kpi-proc-split');
        if (elProcTotal) elProcTotal.innerText = totalProcs;
        if (elProcSplit) elProcSplit.innerText = `${connectedProcs} connected • ${standbyProcs} standby`;

        const elWorkers = document.getElementById('kpi-workers');
        const elTransportSplit = document.getElementById('kpi-transport-split');
        if (elWorkers) elWorkers.innerText = data.activeSessions || 0;
        if (elTransportSplit) elTransportSplit.innerText = `${data.activeSessions || 0} active sessions`;

        const elTools = document.getElementById('kpi-tools');
        if (elTools && data.toolsRegistered) elTools.innerText = data.toolsRegistered;

        const elProcessed = document.getElementById('kpi-processed');
        const elUptime = document.getElementById('kpi-uptime');
        if (elProcessed) elProcessed.innerText = data.totalProcessed || 0;
        if (elUptime && data.uptime !== undefined) {
            currentUptimeSec = data.uptime;
            const m = Math.floor(currentUptimeSec / 60);
            const s = Math.floor(currentUptimeSec % 60);
            elUptime.innerText = `Uptime: ${m}m ${s}s`;
        }

        const statusChip = document.getElementById('brand-status-chip');
        if (statusChip) {
            statusChip.className = 'status-badge online';
            statusChip.innerText = 'Online';
        }

        if (data.mcpSdk) {
            updateSdkDisplay(data.mcpSdk);
        }
    } catch {
        const statusChip = document.getElementById('brand-status-chip');
        if (statusChip) {
            statusChip.className = 'status-badge offline';
            statusChip.innerText = 'Offline';
        }
    }
}

async function loadProcesses() {
    try {
        const res = await fetch('/api/processes');
        const data = await res.json();
        const container = document.getElementById('instances-table-body');
        const countBadge = document.getElementById('instances-count-badge');
        if (!container) return;

        const list = data.processes || [];
        activeProcesses = list;
        if (countBadge) countBadge.innerText = `${list.length} Windows`;

        if (list.length === 0) {
            container.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align:center; padding: 3rem 1rem;">
                        <div class="empty-data-box">
                            <div class="empty-data-title">No Roblox process detected</div>
                            <div class="empty-data-desc">
                                Start Roblox Player or Studio to connect. The server will detect the window automatically.
                            </div>
                            <button class="btn btn-primary btn-sm" onclick="launchRoblox()">+ Launch Roblox</button>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        container.innerHTML = list.map(p => `
            <tr>
                <td style="font-family:var(--font-mono); font-weight:600; color:#fff;">${p.pid}</td>
                <td>${p.windowTitle || p.name || 'Roblox Window'}</td>
                <td>
                    <span class="badge-state ${p.status === 'connected' ? 'connected' : 'standby'}">
                        ${p.status === 'connected' ? 'Connected' : 'Standby'}
                    </span>
                </td>
                <td style="font-family:var(--font-mono);">${p.memoryMB ? p.memoryMB + ' MB' : 'N/A'}</td>
                <td style="font-family:var(--font-mono); font-size:11px; color:var(--text-muted);">${p.transport ? p.transport.toUpperCase() : 'AUTO'}</td>
                <td style="text-align:right;">
                    <div style="display:inline-flex; gap:6px;">
                        <button class="btn btn-sm" onclick="captureWindowScreenshot(${p.pid})">Screenshot</button>
                        <button class="btn btn-sm btn-danger" onclick="killPid(${p.pid})">Close</button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Process query error:', err);
    }
}

async function launchRoblox() {
    notify('Starting Roblox...');
    try {
        const res = await fetch('/api/processes/launch', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            notify(`Roblox started (PID ${data.pid || 'active'})`);
            setTimeout(loadProcesses, 1500);
        } else {
            notify(`Failed to start: ${data.error || 'Unknown error'}`);
        }
    } catch (err) {
        notify('Launch error: ' + err.message);
    }
}

async function killPid(pid) {
    if (!confirm(`Are you sure you want to close Roblox process PID ${pid}?`)) return;
    try {
        const res = await fetch('/api/processes/kill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pid })
        });
        const data = await res.json();
        if (data.success) {
            notify(`Process ${pid} closed`);
            loadProcesses();
        } else {
            notify(`Could not close: ${data.error || 'Unknown error'}`);
        }
    } catch (err) {
        notify('Close error: ' + err.message);
    }
}

async function captureWindowScreenshot(pid) {
    notify(`Capturing screenshot for PID ${pid}...`);
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
            frame.innerHTML = `<img src="${payload.image}" alt="Screenshot for PID ${pid}" style="max-width:100%; height:auto; display:block;">`;
            if (meta) meta.innerText = `PID ${pid} &bull; ${new Date().toLocaleTimeString()}`;
            stage.classList.add('open');
            stage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            notify('Screenshot ready');
        } else if (payload.file_path) {
            notify(`Saved to: ${payload.file_path}`);
        } else {
            notify(payload.error || 'Screenshot captured');
        }
    } catch (err) {
        notify('Screenshot error: ' + err.message);
    }
}

function closeScreenshotStage() {
    const stage = document.getElementById('screenshot-stage');
    if (stage) stage.classList.remove('open');
    const frame = document.getElementById('screenshot-frame');
    if (frame) frame.innerHTML = '<div style="color:var(--text-muted); font-size:12px; padding:2rem;">No screenshot captured yet</div>';
}

async function loadTools() {
    try {
        const res = await fetch('/api/tools');
        const data = await res.json();
        allTools = data.tools || [];

        const elHeaderCount = document.getElementById('tools-total-count');
        const elAllPill = document.getElementById('cnt-cat-all');
        if (elHeaderCount) elHeaderCount.innerText = allTools.length;
        if (elAllPill) elAllPill.innerText = allTools.length;

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

        const debugToolSelect = document.getElementById('debug-filter-tool');
        if (debugToolSelect && allTools.length > 0) {
            const currentVal = debugToolSelect.value;
            let options = '<option value="">All Tools</option>';
            allTools.forEach(t => {
                options += `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`;
            });
            debugToolSelect.innerHTML = options;
            debugToolSelect.value = currentVal;
        }

        renderToolsList();
    } catch (err) {
        console.error('Tools list error:', err);
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
            <div style="padding: 2.5rem 1rem; text-align: center; color: var(--text-muted); font-size: 12px;">
                No tools matching "${query}"
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
                <div class="empty-data-title">Select a tool</div>
                <div class="empty-data-desc">Pick any tool from the list to view its arguments and run live queries.</div>
            </div>
        `;
        return;
    }

    const schema = tool.inputSchema || {};
    const props = schema.properties || {};
    const reqList = schema.required || [];
    const propKeys = Object.keys(props);

    const sampleArgs = {};
    propKeys.forEach(k => {
        if (k === 'workerId') sampleArgs[k] = 'Worker_14388';
        else if (k === 'pid') sampleArgs[k] = activeProcesses[0]?.pid || 14388;
        else if (props[k].type === 'boolean') sampleArgs[k] = true;
        else if (props[k].type === 'number') sampleArgs[k] = 100;
        else if (props[k].type === 'array') sampleArgs[k] = ['item_1'];
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
                    <span class="detail-badge active">${tool.category || 'General'}</span>
                    <span class="detail-badge">JSON-RPC 2.0</span>
                </div>
            </div>
            <div class="detail-description">${tool.description || 'No description provided.'}</div>
        </div>

        <div>
            <div class="param-section-title">Tool Call Example</div>
            <div class="terminal-code-box">
                <div class="terminal-code-head">
                    <span>JSON-RPC Format</span>
                    <button class="btn btn-sm" onclick="copySnippetText('code-spec-${tool.name}')">Copy JSON</button>
                </div>
                <pre class="terminal-code-body" id="code-spec-${tool.name}">${mcpSampleJson}</pre>
            </div>
        </div>

        <div>
            <div class="param-section-title">Arguments (${propKeys.length})</div>
            <div class="param-grid-table">
                ${propKeys.length === 0 ? `
                    <div style="padding:1rem; color:var(--text-muted); font-size:12px;">
                        This tool accepts no arguments.
                    </div>
                ` : propKeys.map(k => {
                    const p = props[k];
                    const isReq = reqList.includes(k);
                    const typeLabel = (p.type || 'any').toUpperCase();

                    return `
                        <div class="param-grid-row">
                            <div class="param-meta-col">
                                <span class="param-name-label">${k}</span>
                                <span class="param-type-label">${typeLabel} ${isReq ? '&bull; Required' : '&bull; Optional'}</span>
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

        <div>
            <div class="param-section-title">Test Runner</div>
            <div class="exec-control-bar">
                <button class="btn btn-primary" id="btn-exec-${tool.name}" onclick="executeTool('${tool.name}')">
                    <span>Run Tool</span>
                </button>
                <div class="exec-meta-status" id="exec-status-${tool.name}">
                    <span>Ready</span>
                </div>
                <button class="btn btn-sm" onclick="clearTerminal('${tool.name}')">Clear Output</button>
            </div>
            <pre class="output-terminal" id="terminal-out-${tool.name}">// Click "Run Tool" to send the request to connected game clients.</pre>
        </div>
    `;
}

async function executeTool(name) {
    const tool = allTools.find(t => t.name === name);
    if (!tool) return;

    const outBox = document.getElementById('terminal-out-' + name);
    const statusBox = document.getElementById('exec-status-' + name);

    if (outBox) outBox.innerText = '// Running tool request...';
    if (statusBox) statusBox.innerHTML = '<span>Running...</span>';

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
            outBox.innerText = `// Completed in ${elapsed}ms\n` + (typeof display === 'string' ? display : JSON.stringify(display, null, 2));
        }
        if (statusBox) statusBox.innerHTML = `<span>Completed (${elapsed}ms)</span>`;
        notify(`${name} finished (${elapsed}ms)`);
    } catch (err) {
        if (outBox) outBox.innerText = `// Error: ${err.message}`;
        if (statusBox) statusBox.innerHTML = `<span style="color:var(--rose);">Failed</span>`;
        notify('Execution error: ' + err.message);
    }
}

function clearTerminal(name) {
    const outBox = document.getElementById('terminal-out-' + name);
    if (outBox) outBox.innerText = '// Output cleared.';
}

function copySnippetText(elemId) {
    const el = document.getElementById(elemId);
    if (!el) return;
    navigator.clipboard.writeText(el.innerText).then(() => {
        notify('JSON snippet copied');
    }).catch(() => {
        prompt('Copy snippet:', el.innerText);
    });
}

async function loadPortConfig() {
    try {
        const res = await fetch('/api/config/port');
        const data = await res.json();

        const elCur = document.getElementById('stat-cur-port');
        const elDisc = document.getElementById('stat-disc-port');
        const elSaved = document.getElementById('stat-saved-port');
        const elInp = document.getElementById('input-custom-port');

        if (elCur) elCur.innerText = data.currentPort;
        if (elDisc) elDisc.innerText = `${data.discoveryPort} (router)`;
        if (elSaved) elSaved.innerText = data.savedPort ? data.savedPort : '(Default)';
        if (elInp && !elInp.value) elInp.value = data.currentPort;

        const snipDirect = document.getElementById('code-direct-loader');
        const snipDisc = document.getElementById('code-disc-loader');
        const snipCli = document.getElementById('code-cli-cmd');

        if (snipDirect) snipDirect.innerText = `loadstring(game:HttpGet("http://127.0.0.1:${data.currentPort}/mcp.lua"))()`;
        if (snipDisc) snipDisc.innerText = `loadstring(game:HttpGet("http://127.0.0.1:${data.discoveryPort || 58295}/mcp.lua"))()`;
        if (snipCli) snipCli.innerText = `rblx-mcp start --port ${data.currentPort}`;
    } catch (err) {
        console.error('Port config error:', err);
    }
}

async function checkPortAvailability() {
    const inp = document.getElementById('input-custom-port');
    const out = document.getElementById('port-check-status');
    if (!inp || !out) return;

    const portNum = parseInt(inp.value.trim(), 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        out.innerHTML = '<span style="color:var(--rose);">Port must be between 1 and 65535</span>';
        return;
    }

    out.innerHTML = '<span style="color:var(--text-muted);">Checking port...</span>';
    try {
        const res = await fetch('/api/config/port-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port: portNum })
        });
        const data = await res.json();
        if (data.available) {
            out.innerHTML = `<span style="color:var(--emerald);">Port ${portNum} is free and ready to use</span>`;
        } else {
            out.innerHTML = `<span style="color:var(--amber);">Port ${portNum} is currently in use by another app</span>`;
        }
    } catch (err) {
        out.innerHTML = `<span style="color:var(--rose);">Check failed: ${err.message}</span>`;
    }
}

async function savePreferredPort() {
    const inp = document.getElementById('input-custom-port');
    if (!inp) return;
    const portNum = parseInt(inp.value.trim(), 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        notify('Enter a valid port (1-65535)');
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
            notify(`Default port saved: ${portNum}`);
            loadPortConfig();
        } else {
            notify(`Could not save: ${data.error}`);
        }
    } catch (err) {
        notify('Save failed: ' + err.message);
    }
}

async function loadUncMatrix() {
    try {
        const res = await fetch('/api/unc');
        const data = await res.json();
        const container = document.getElementById('unc-matrix-cells');
        const countTag = document.getElementById('unc-count-tag');
        const execTag = document.getElementById('unc-executor-badge');

        const list = data.standardFunctions || [];
        if (countTag) countTag.innerText = `${list.length} Functions`;
        if (execTag && data.capabilities) {
            execTag.innerText = `Executor: ${data.capabilities.executorName || 'None'} (${data.capabilities.supported || 0}/${data.capabilities.total || list.length})`;
        }

        if (container) {
            container.innerHTML = list.map(item => `
                <div class="unc-cell">
                    <div class="unc-cell-head">
                        <span class="unc-func-name">${item.name}</span>
                        <span class="unc-func-cat">${item.category}</span>
                    </div>
                    <div class="unc-func-desc">${item.desc}</div>
                    <div class="unc-fallback-meta">Fallback: ${item.fallback}</div>
                </div>
            `).join('');
        }
    } catch (err) {
        console.error('UNC load error:', err);
    }
}

async function setTransportMode(mode) {
    notify(`Setting transport to ${mode}...`);
    try {
        const res = await fetch('/api/transport', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode })
        });
        const data = await res.json();
        if (data.success) {
            notify(`Transport active: ${mode}`);
        }
    } catch (err) {
        notify('Transport error: ' + err.message);
    }
}

async function toggleAutoexecute() {
    try {
        const res = await fetch('/api/autoexecute', { method: 'POST' });
        const data = await res.json();
        const stateStr = data.enabled ? 'On' : 'Off';
        notify(`Teleport autoexec: ${stateStr}`);
        const chip = document.getElementById('quick-autoexec-chip');
        if (chip) chip.innerText = stateStr;
    } catch (err) {
        notify('Autoexec error: ' + err.message);
    }
}

async function shutdownServer() {
    if (!confirm('Are you sure you want to stop the server? This will disconnect all connected clients.')) return;
    try {
        await fetch('/stop', { method: 'POST' });
        notify('Server shutting down...');
        setTimeout(() => location.reload(), 1500);
    } catch {
        notify('Server stopped');
    }
}

function updateSdkDisplay(diag) {
    if (!diag) return;
    const elVer = document.getElementById('ops-sdk-version');
    const elProt = document.getElementById('ops-sdk-protocol');
    const elStrat = document.getElementById('ops-sdk-strategy');
    const elSummary = document.getElementById('ops-sdk-summary');

    if (elVer) elVer.innerText = `v${diag.version || '1.30.0'}`;
    if (elProt) elProt.innerText = diag.latestProtocolVersion || '2025-11-25';
    if (elStrat) elStrat.innerText = diag.resolvedStrategy ? diag.resolvedStrategy.replace('-', ' ') : 'standard exports';
    if (elSummary) {
        elSummary.innerText = diag.available
            ? `Verified ${diag.availableSchemas ? diag.availableSchemas.length : 40} protocol schemas. SDK is operational.`
            : `Warning: ${diag.warnings ? diag.warnings.join('; ') : 'Check SDK install'}`;
    }
}

async function runSdkScan() {
    notify('Scanning MCP SDK...');
    try {
        const res = await fetch('/api/mcp/sdk');
        const data = await res.json();
        updateSdkDisplay(data);
        notify(`SDK scan complete (${data.scanDurationMs || 0}ms)`);
    } catch (err) {
        notify('Scan error: ' + err.message);
    }
}

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
        notify('Loader script copied');
        closeLoaderModal();
    }).catch(() => {
        prompt('Copy snippet:', code);
    });
}

function openSkillModal() {
    const modal = document.getElementById('skill-modal');
    if (modal) modal.classList.add('open');
}

function closeSkillModal(e) {
    if (e && e.target && e.target !== e.currentTarget && !e.target.closest('.modal-close-btn')) {
        return;
    }
    const modal = document.getElementById('skill-modal');
    if (modal) modal.classList.remove('open');
}

async function deploySkillTarget(targetId) {
    notify(`Installing skill to ${targetId}...`);
    const feedback = document.getElementById('skill-deploy-feedback');
    if (feedback) feedback.innerText = `Installing to ${targetId}...`;

    try {
        const res = await fetch('/api/skill/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targets: [targetId] })
        });
        const data = await res.json();
        if (data.success && data.results && data.results[0] && data.results[0].success) {
            notify(`Skill installed: ${data.results[0].name}`);
            if (feedback) feedback.innerText = `Saved to: ${data.results[0].destinationPath}`;
        } else {
            const err = data.results?.[0]?.error || 'Install failed';
            notify(`Error: ${err}`);
            if (feedback) feedback.innerText = `Error: ${err}`;
        }
    } catch (err) {
        notify(`Error: ${err.message}`);
        if (feedback) feedback.innerText = `Error: ${err.message}`;
    }
}

async function deployAllSkillTargets() {
    notify('Installing skill to all targets...');
    const feedback = document.getElementById('skill-deploy-feedback');
    if (feedback) feedback.innerText = 'Installing to Claude Code, Cursor, and Windsurf...';

    try {
        const targets = ['claude-code-global', 'cursor-project', 'windsurf-project'];
        const res = await fetch('/api/skill/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targets })
        });
        const data = await res.json();
        if (data.success) {
            notify(`Skill installed to ${data.count || 0} targets`);
            if (feedback) feedback.innerText = `Installed to ${data.count} AI target configurations.`;
        } else {
            notify('Installation failed');
            if (feedback) feedback.innerText = 'Could not install to all targets.';
        }
    } catch (err) {
        notify(`Error: ${err.message}`);
        if (feedback) feedback.innerText = `Error: ${err.message}`;
    }
}

async function copySkillMarkdown() {
    notify('Reading skill markdown...');
    try {
        const res = await fetch('/api/skill');
        const data = await res.json();
        if (data.markdown) {
            navigator.clipboard.writeText(data.markdown).then(() => {
                notify('Skill markdown copied to clipboard');
                const feedback = document.getElementById('skill-deploy-feedback');
                if (feedback) feedback.innerText = 'SKILL.md copied. Paste it into your AI assistant rules.';
            }).catch(() => {
                prompt('Copy SKILL.md:', data.markdown.slice(0, 100) + '...');
            });
        }
    } catch (err) {
        notify(`Error: ${err.message}`);
    }
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeLoaderModal();
        closeSkillModal();
        closeScreenshotStage();
        return;
    }

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
    } else if (e.key === '6') {
        switchView('debug');
    } else if (e.key.toLowerCase() === 'l') {
        openLoaderModal();
    } else if (e.key.toLowerCase() === 'r') {
        loadProcesses();
        fetchTelemetry();
        fetchDebugStatus();
        notify('Data refreshed');
    }
});

let debugSessions = [];
let selectedDebugSessionId = null;
let debugSearchDebounce = null;

async function fetchDebugStatus() {
    try {
        const res = await fetch('/api/debug');
        const data = await res.json();
        const enabled = !!data.enabled;

        const quickChip = document.getElementById('quick-debug-chip');
        if (quickChip) {
            quickChip.innerText = enabled ? 'On' : 'Off';
            quickChip.style.color = enabled ? 'var(--emerald)' : 'var(--text-muted)';
        }

        const stateChip = document.getElementById('debug-state-chip');
        if (stateChip) {
            stateChip.className = enabled ? 'status-badge online' : 'status-badge offline';
            stateChip.innerText = enabled ? 'Recording Active' : 'Recording Paused';
        }

        const btnToggle = document.getElementById('btn-toggle-debug-view');
        if (btnToggle) {
            btnToggle.innerText = enabled ? 'Pause Logging' : 'Resume Logging';
            btnToggle.className = enabled ? 'btn btn-sm btn-danger' : 'btn btn-sm btn-primary';
        }

        const opsStatus = document.getElementById('ops-debug-status');
        if (opsStatus) opsStatus.innerText = enabled ? 'Active' : 'Paused';

        const opsCount = document.getElementById('ops-debug-sessions-count');
        if (opsCount) opsCount.innerText = `${data.totalSessions || 0} sessions (${data.totalEvents || 0} events)`;

        const kpi = document.getElementById('debug-sessions-kpi');
        if (kpi) kpi.innerText = `${data.totalSessions || 0} Sessions`;
    } catch {}
}

async function toggleDebugMode() {
    try {
        const res = await fetch('/api/debug/toggle', { method: 'POST' });
        const data = await res.json();
        notify(data.message || 'Debug mode toggled');
        fetchDebugStatus();
    } catch (err) {
        notify('Failed to toggle debug: ' + err.message);
    }
}

async function loadDebugSessions(force = false) {
    const container = document.getElementById('debug-sessions-list-container');
    const countTag = document.getElementById('debug-session-count-tag');
    if (!container) return;

    try {
        const res = await fetch('/api/debug/sessions?limit=100');
        const data = await res.json();
        debugSessions = data.sessions || [];

        if (countTag) countTag.innerText = `${debugSessions.length} total`;

        filterDebugSessionsList();

        if (!selectedDebugSessionId || force) {
            loadRecentDebugEvents();
        }
    } catch (err) {
        console.error('Failed to load debug sessions:', err);
    }
}

function filterDebugSessionsList() {
    const container = document.getElementById('debug-sessions-list-container');
    if (!container) return;

    const query = (document.getElementById('debug-session-search')?.value || '').toLowerCase().trim();
    let filtered = debugSessions;

    if (query) {
        filtered = filtered.filter(s =>
            (s.sessionId && s.sessionId.toLowerCase().includes(query)) ||
            (s.playerName && s.playerName.toLowerCase().includes(query)) ||
            (s.pid && String(s.pid).includes(query))
        );
    }

    if (filtered.length === 0) {
        container.innerHTML = `
            <div style="padding:1.5rem; text-align:center; color:var(--text-muted); font-size:12px;">
                ${debugSessions.length === 0 ? 'No debug sessions recorded yet.' : 'No matching sessions.'}
            </div>
        `;
        return;
    }

    let html = `
        <div class="debug-session-card ${selectedDebugSessionId === null ? 'selected' : ''}" onclick="selectDebugSession(null)">
            <div class="debug-session-top">
                <span class="debug-session-id" style="color:var(--text-primary); font-weight:700;">★ All Recent Events</span>
                <span class="status-badge online" style="font-size:10px;">Global</span>
            </div>
            <div class="debug-session-meta">
                <span>Aggregated live feed</span>
            </div>
        </div>
    `;

    html += filtered.map(s => {
        const isSelected = selectedDebugSessionId === s.sessionId;
        const isActive = s.status === 'active';
        const dateStr = new Date(s.lastActivityTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const nameDisplay = s.playerName ? `${s.playerName}` : (s.pid ? `PID ${s.pid}` : s.sessionId);
        return `
            <div class="debug-session-card ${isSelected ? 'selected' : ''}" onclick="selectDebugSession('${s.sessionId}')">
                <div class="debug-session-top">
                    <span class="debug-session-id" title="${s.sessionId}">${escapeHtml(nameDisplay)}</span>
                    <span class="status-badge ${isActive ? 'online' : ''}" style="font-size:10px;">${isActive ? 'Active' : 'Saved'}</span>
                </div>
                <div class="debug-session-meta">
                    <span>${s.eventCount || 0} events</span>
                    ${s.errorCount ? `<span style="color:var(--rose); font-weight:600;">• ${s.errorCount} err</span>` : ''}
                    <span>• ${dateStr}</span>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = html;
}

async function selectDebugSession(sessionId) {
    selectedDebugSessionId = sessionId;
    filterDebugSessionsList();

    const titleEl = document.getElementById('debug-timeline-title');
    const subEl = document.getElementById('debug-timeline-subtitle');

    if (!sessionId) {
        if (titleEl) titleEl.innerText = 'Recent MCP Actions (All Sessions)';
        if (subEl) subEl.innerText = 'Aggregated history';
        loadRecentDebugEvents();
        return;
    }

    const session = debugSessions.find(s => s.sessionId === sessionId);
    if (titleEl) {
        titleEl.innerText = session?.playerName ? `${session.playerName} (PID ${session.pid || '?'})` : sessionId;
    }
    if (subEl) {
        subEl.innerText = session?.status === 'active' ? '● Connected' : '○ Preserved from disk';
    }

    reloadSelectedSessionEvents();
}

async function loadRecentDebugEvents() {
    const container = document.getElementById('debug-events-stream-container');
    if (!container) return;

    const tool = document.getElementById('debug-filter-tool')?.value || '';
    const status = document.getElementById('debug-filter-status')?.value || '';
    const exec = document.getElementById('debug-filter-exec')?.value || 'all';
    const search = document.getElementById('debug-filter-search')?.value || '';

    let url = `/api/debug/recent?limit=80`;
    if (status) url += `&status=${encodeURIComponent(status)}`;
    if (exec && exec !== 'all') url += `&execution=${encodeURIComponent(exec)}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;

    try {
        const res = await fetch(url);
        const data = await res.json();
        renderDebugEvents(data.events || []);
    } catch (err) {
        container.innerHTML = `<div style="padding:1.5rem; color:var(--rose);">Failed to load recent events: ${err.message}</div>`;
    }
}

async function reloadSelectedSessionEvents() {
    if (!selectedDebugSessionId) {
        loadRecentDebugEvents();
        return;
    }

    const container = document.getElementById('debug-events-stream-container');
    if (!container) return;

    const tool = document.getElementById('debug-filter-tool')?.value || '';
    const status = document.getElementById('debug-filter-status')?.value || '';
    const exec = document.getElementById('debug-filter-exec')?.value || 'all';
    const search = document.getElementById('debug-filter-search')?.value || '';

    let url = `/api/debug/sessions/${encodeURIComponent(selectedDebugSessionId)}?limit=150`;
    if (tool) url += `&tool=${encodeURIComponent(tool)}`;
    if (status) url += `&status=${encodeURIComponent(status)}`;
    if (exec && exec !== 'all') url += `&execution=${encodeURIComponent(exec)}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;

    try {
        const res = await fetch(url);
        const data = await res.json();
        renderDebugEvents(data.events || []);
    } catch (err) {
        container.innerHTML = `<div style="padding:1.5rem; color:var(--rose);">Failed to load session events: ${err.message}</div>`;
    }
}

function debounceReloadEvents() {
    clearTimeout(debugSearchDebounce);
    debugSearchDebounce = setTimeout(() => {
        reloadSelectedSessionEvents();
    }, 200);
}

const currentDebugEventsMap = new Map();
let currentInspectedEventId = null;
let currentInspectorTab = 'ui';

function getTypeLabel(val) {
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (Array.isArray(val)) return `arr[${val.length}]`;
    return typeof val;
}

function renderVisualData(data) {
    if (data === null) {
        return '<span style="color:var(--text-muted); font-style:italic;">null</span>';
    }
    if (data === undefined) {
        return '<span style="color:var(--text-muted); font-style:italic;">undefined</span>';
    }
    if (typeof data === 'boolean') {
        return `<span style="color:${data ? 'var(--emerald)' : 'var(--rose)'}; font-weight:700;">${data}</span>`;
    }
    if (typeof data === 'number') {
        return `<span style="color:#60a5fa; font-weight:600;">${data}</span>`;
    }
    if (typeof data === 'string') {
        if (data.startsWith('data:image/')) {
            return `
                <div style="display:flex; align-items:center; gap:0.6rem;">
                    <img src="${data}" style="max-height:75px; max-width:140px; border-radius:4px; border:1px solid var(--border-mid); object-fit:contain;">
                    <span style="font-size:11px; color:var(--text-muted); font-family:var(--font-mono);">(Image capture)</span>
                </div>
            `;
        }
        if (data.length > 70 || data.includes('\n')) {
            return `<pre class="debug-event-code">${escapeHtml(data)}</pre>`;
        }
        return `<span style="color:#a7f3d0;">"${escapeHtml(data)}"</span>`;
    }
    if (Array.isArray(data)) {
        if (data.length === 0) {
            return '<span style="color:var(--text-muted); font-family:var(--font-mono);">[ empty array ]</span>';
        }
        return `
            <div style="display:flex; flex-direction:column; gap:4px; margin-top:3px;">
                <span class="debug-kv-type-badge">${data.length} items</span>
                <div class="debug-kv-list" style="margin-left:8px; border-left:2px solid var(--border-subtle); padding-left:6px;">
                    ${data.slice(0, 20).map((item, idx) => `
                        <div class="debug-kv-item">
                            <span style="font-size:10px; color:var(--text-muted); font-family:var(--font-mono);">[${idx}]</span>
                            <div class="debug-kv-value">${renderVisualData(item)}</div>
                        </div>
                    `).join('')}
                    ${data.length > 20 ? `<span style="font-size:10px; color:var(--text-muted);">... and ${data.length - 20} more items</span>` : ''}
                </div>
            </div>
        `;
    }
    if (typeof data === 'object') {
        const keys = Object.keys(data);
        if (keys.length === 0) {
            return '<span style="color:var(--text-muted); font-family:var(--font-mono);">{ empty object }</span>';
        }
        return `
            <div class="debug-kv-list">
                ${keys.map(k => `
                    <div class="debug-kv-item">
                        <div class="debug-kv-label-row">
                            <span class="debug-kv-key">${escapeHtml(k)}</span>
                            <span class="debug-kv-type-badge">${getTypeLabel(data[k])}</span>
                        </div>
                        <div class="debug-kv-value">${renderVisualData(data[k])}</div>
                    </div>
                `).join('')}
            </div>
        `;
    }
    return escapeHtml(String(data));
}

function renderDebugEvents(events) {
    const container = document.getElementById('debug-events-stream-container');
    if (!container) return;

    if (!events || events.length === 0) {
        container.innerHTML = `
            <div style="padding:2.5rem; text-align:center; color:var(--text-muted); font-size:12px;">
                No events recorded matching this filter.
            </div>
        `;
        return;
    }

    currentDebugEventsMap.clear();

    container.innerHTML = events.map(e => {
        currentDebugEventsMap.set(e.id, e);

        const isClient = e.execution === 'client';
        const execLabel = isClient ? 'CLIENT (Roblox)' : 'SERVER (MCP)';
        const execClass = isClient ? 'client' : 'server';

        const status = e.status || (e.error ? 'error' : 'success');
        const statusLabel = status.toUpperCase();

        const timeStr = new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
        const toolName = e.tool || e.type || 'action';

        const isErr = status === 'error';
        const borderStyle = isErr ? 'event-error' : (status === 'success' ? 'event-success' : '');

        let targetDisplay = e.sessionId ? escapeHtml(e.sessionId) : 'Global';
        if (e.playerName) targetDisplay = `${escapeHtml(e.playerName)} (PID ${e.pid || '?'})`;

        return `
            <div class="debug-event-card ${borderStyle}" id="card-${e.id}">
                <div class="debug-event-head">
                    <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                        <span class="debug-status-pill ${status}">${statusLabel}</span>
                        <span class="debug-exec-pill ${execClass}">${execLabel}</span>
                        <span class="debug-event-tool">${escapeHtml(toolName)}</span>
                        <span style="font-size:11px; color:var(--text-muted); font-family:var(--font-mono);">[${targetDisplay}]</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:0.5rem;">
                        ${e.durationMs !== undefined ? `<span class="debug-event-duration">${e.durationMs}ms</span>` : ''}
                        <span class="debug-event-time">${timeStr}</span>
                        <div class="debug-btn-group">
                            <button class="debug-icon-btn" id="btn-toggle-${e.id}" onclick="toggleCardMinimize('${e.id}')" title="Extend or minimize card">[-]</button>
                            <button class="debug-icon-btn" onclick="openDebugInspector('${e.id}')" title="Maximize inspector">⛶</button>
                            <button class="debug-icon-btn" onclick="copyEventJson('${e.id}')" title="Copy action JSON">📋</button>
                        </div>
                    </div>
                </div>

                <div class="debug-card-body" id="body-${e.id}">
                    <div class="debug-panels-row">
                        <div class="debug-panel-box">
                            <div class="debug-panel-head">
                                <span>INPUT (arguments)</span>
                                <button class="debug-icon-btn" onclick="copySnippet('${e.id}', 'arguments')">Copy</button>
                            </div>
                            <div class="debug-panel-content">
                                ${e.arguments && Object.keys(e.arguments).length > 0
                                    ? renderVisualData(e.arguments)
                                    : '<span style="color:var(--text-muted); font-size:11px; font-style:italic;">No arguments supplied</span>'}
                            </div>
                        </div>

                        <div class="debug-panel-box">
                            <div class="debug-panel-head">
                                <span style="color:${isErr ? 'var(--rose)' : 'var(--emerald)'};">OUTPUT (${isErr ? 'error' : 'result'})</span>
                                <button class="debug-icon-btn" onclick="copySnippet('${e.id}', '${isErr ? 'error' : 'result'}')">Copy</button>
                            </div>
                            <div class="debug-panel-content">
                                ${isErr
                                    ? `<div style="color:#fca5a5; font-family:var(--font-mono); font-size:11px; line-height:1.45; word-break:break-all;"><strong style="color:var(--rose);">Error:</strong> ${escapeHtml(e.error || 'Execution failed')}</div>`
                                    : (e.result !== undefined
                                        ? renderVisualData(e.result)
                                        : '<span style="color:var(--amber); font-size:11px; font-style:italic;">Pending response...</span>')}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function toggleCardMinimize(eventId) {
    const card = document.getElementById(`card-${eventId}`);
    const btn = document.getElementById(`btn-toggle-${eventId}`);
    if (!card) return;
    const isMinimized = card.classList.toggle('minimized');
    if (btn) btn.innerText = isMinimized ? '[+]' : '[-]';
}

function expandAllDebugCards() {
    document.querySelectorAll('.debug-event-card').forEach(c => {
        c.classList.remove('minimized');
        const btn = c.querySelector('.debug-icon-btn');
        if (btn && (btn.innerText === '[+]' || btn.innerText === '[-]')) btn.innerText = '[-]';
    });
}

function collapseAllDebugCards() {
    document.querySelectorAll('.debug-event-card').forEach(c => {
        c.classList.add('minimized');
        const btn = c.querySelector('.debug-icon-btn');
        if (btn && (btn.innerText === '[+]' || btn.innerText === '[-]')) btn.innerText = '[+]';
    });
}

function openDebugInspector(eventId) {
    const e = currentDebugEventsMap.get(eventId);
    if (!e) return;
    currentInspectedEventId = eventId;

    const modal = document.getElementById('debug-inspector-modal');
    const toolTitle = document.getElementById('debug-modal-tool-name');
    const execTag = document.getElementById('debug-modal-exec-tag');
    const statusTag = document.getElementById('debug-modal-status-tag');
    const metaBar = document.getElementById('debug-modal-meta-bar');
    const footerInfo = document.getElementById('debug-modal-footer-info');

    if (toolTitle) toolTitle.innerText = e.tool || e.type || 'Action Inspector';

    const isClient = e.execution === 'client';
    if (execTag) {
        execTag.className = `status-badge ${isClient ? '' : 'online'}`;
        execTag.innerText = isClient ? 'CLIENT (Roblox Executor)' : 'SERVER (Node MCP)';
    }

    const isErr = e.status === 'error' || !!e.error;
    if (statusTag) {
        statusTag.className = `status-badge ${isErr ? 'offline' : 'online'}`;
        statusTag.innerText = isErr ? 'ERROR' : (e.status === 'pending' ? 'PENDING' : 'SUCCESS');
    }

    if (metaBar) {
        metaBar.innerHTML = `
            <div class="debug-modal-meta-item">
                <span class="debug-modal-meta-key">Session:</span>
                <span class="debug-modal-meta-val">${escapeHtml(e.sessionId || 'Global')}</span>
            </div>
            ${e.pid ? `
            <div class="debug-modal-meta-item">
                <span class="debug-modal-meta-key">Roblox PID:</span>
                <span class="debug-modal-meta-val">${e.pid}</span>
            </div>` : ''}
            ${e.playerName ? `
            <div class="debug-modal-meta-item">
                <span class="debug-modal-meta-key">Player:</span>
                <span class="debug-modal-meta-val">${escapeHtml(e.playerName)}</span>
            </div>` : ''}
            <div class="debug-modal-meta-item">
                <span class="debug-modal-meta-key">Duration:</span>
                <span class="debug-modal-meta-val">${e.durationMs !== undefined ? `${e.durationMs}ms` : 'In-flight'}</span>
            </div>
            <div class="debug-modal-meta-item">
                <span class="debug-modal-meta-key">Timestamp:</span>
                <span class="debug-modal-meta-val">${e.isoTime || new Date(e.timestamp).toISOString()}</span>
            </div>
        `;
    }

    if (footerInfo) footerInfo.innerText = `ID: ${e.id}`;

    renderInspectorContent();
    if (modal) modal.classList.add('open');
}

function closeDebugInspector(e) {
    if (e && e.target && e.target !== e.currentTarget && !e.target.closest('.modal-close-btn')) {
        return;
    }
    const modal = document.getElementById('debug-inspector-modal');
    if (modal) modal.classList.remove('open');
    currentInspectedEventId = null;
}

function switchInspectorTab(tab) {
    currentInspectorTab = tab;
    document.querySelectorAll('.debug-tab-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`debug-tab-${tab}`);
    if (btn) btn.classList.add('active');
    renderInspectorContent();
}

function renderInspectorContent() {
    const container = document.getElementById('debug-modal-content-area');
    if (!container || !currentInspectedEventId) return;
    const e = currentDebugEventsMap.get(currentInspectedEventId);
    if (!e) return;

    if (currentInspectorTab === 'json') {
        const fullJson = JSON.stringify(e, null, 2);
        container.innerHTML = `
            <pre class="debug-event-code" style="max-height:550px; font-size:12px; line-height:1.5;">${escapeHtml(fullJson)}</pre>
        `;
        return;
    }

    const isErr = e.status === 'error' || !!e.error;
    container.innerHTML = `
        <div class="debug-panels-row" style="margin-top:0.5rem; height:100%; min-height:400px;">
            <div class="debug-panel-box" style="flex:1;">
                <div class="debug-panel-head">
                    <span style="font-weight:700;">INPUT (arguments)</span>
                    <button class="debug-icon-btn" onclick="copySnippet('${e.id}', 'arguments')">Copy Arguments</button>
                </div>
                <div class="debug-panel-content" style="max-height:480px; overflow-y:auto;">
                    ${e.arguments && Object.keys(e.arguments).length > 0
                        ? renderVisualData(e.arguments)
                        : '<span style="color:var(--text-muted); font-size:12px; font-style:italic;">No arguments supplied</span>'}
                </div>
            </div>

            <div class="debug-panel-box" style="flex:1;">
                <div class="debug-panel-head">
                    <span style="font-weight:700; color:${isErr ? 'var(--rose)' : 'var(--emerald)'};">OUTPUT (${isErr ? 'error' : 'result'})</span>
                    <button class="debug-icon-btn" onclick="copySnippet('${e.id}', '${isErr ? 'error' : 'result'}')">Copy Output</button>
                </div>
                <div class="debug-panel-content" style="max-height:480px; overflow-y:auto;">
                    ${isErr
                        ? `<div style="color:#fca5a5; font-family:var(--font-mono); font-size:12px; line-height:1.5;"><strong style="color:var(--rose);">Error Message:</strong><br>${escapeHtml(e.error || 'Execution failed')}</div>`
                        : (e.result !== undefined
                            ? renderVisualData(e.result)
                            : '<span style="color:var(--amber); font-size:12px; font-style:italic;">Pending execution...</span>')}
                </div>
            </div>
        </div>
    `;
}

function copyEventJson(eventId) {
    const e = currentDebugEventsMap.get(eventId);
    if (!e) return;
    navigator.clipboard.writeText(JSON.stringify(e, null, 2)).then(() => {
        notify('Action JSON copied');
    });
}

function copySnippet(eventId, field) {
    const e = currentDebugEventsMap.get(eventId);
    if (!e) return;
    const target = field === 'arguments' ? e.arguments : (e.error ? e.error : e.result);
    const text = typeof target === 'string' ? target : JSON.stringify(target, null, 2);
    navigator.clipboard.writeText(text).then(() => {
        notify(`${field} copied`);
    });
}

function copyInspectorData() {
    if (!currentInspectedEventId) return;
    copyEventJson(currentInspectedEventId);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function clearAllDebugLogs() {
    if (!confirm('Are you sure you want to clear all persistent debug memory across all sessions?')) return;
    try {
        const res = await fetch('/api/debug', { method: 'DELETE' });
        const data = await res.json();
        notify(`Cleared ${data.clearedCount || 0} debug sessions`);
        fetchDebugStatus();
        loadDebugSessions(true);
    } catch (err) {
        notify('Failed to clear: ' + err.message);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    fetchTelemetry();
    loadProcesses();
    loadTools();
    loadPortConfig();
    fetchDebugStatus();

    pollTimer = setInterval(() => {
        fetchTelemetry();
        loadProcesses();
        fetchDebugStatus();
    }, 2500);
});
