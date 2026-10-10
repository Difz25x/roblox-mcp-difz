import type { Server as HttpServer } from 'http';
const WebSocket = require('ws');

const HEARTBEAT_MS = 30000;
const REGISTER_TIMEOUT_MS = 10000;

type WS = InstanceType<typeof WebSocket>;

function enumWindows() {
    try { return require('./process-manager').enumRobloxWindows(); } catch { return []; }
}

function matchRobloxPid(placeName: string, placeId?: string|number): number|undefined {
    let procMgr: any;
    try { procMgr = require('./process-manager'); } catch { return undefined; }

    const name = (placeName || '').toLowerCase();
    const idStr = placeId ? String(placeId) : '';

    // 1. Try window title match first
    try {
        const wins = procMgr.enumRobloxWindows ? procMgr.enumRobloxWindows() : [];
        if (wins?.length) {
            for (const w of wins) {
                const t = (w.title || '').toLowerCase();
                if (!t.includes('roblox')) continue;
                if (idStr && t.includes(idStr)) return w.pid;
                if (name && t.includes(name)) return w.pid;
            }
            if (wins[0]?.pid) return wins[0].pid;
        }
    } catch {}

    // 2. Fallback to process list
    try {
        const procs = procMgr.listRobloxProcesses ? procMgr.listRobloxProcesses() : [];
        if (procs?.length === 1) {
            return procs[0].pid;
        }
        if (procs?.length > 1) {
            for (const p of procs) {
                const t = (p.windowTitle || '').toLowerCase();
                if (idStr && t.includes(idStr)) return p.pid;
                if (name && t.includes(name)) return p.pid;
            }
            return procs[0].pid;
        }
    } catch {}

    return undefined;
}

class WsServer {
    sessions: any;
    queue: any;
    allConnections = new Set<WS>();
    workers = new Map<string, any>();
    pidMap = new Map<number, string>();
    wss: any = null;
    _taskHandler: any = null;

    constructor(queue: any, sessions: any) {
        this.queue = queue;
        this.sessions = sessions;
        this._startHeartbeat();
    }

    mount(server: HttpServer) {
        this.wss = new WebSocket.Server({ server, path: '/ws' });

        this.wss.on('connection', (ws: WS) => {
            this.allConnections.add(ws);
            let workerId: string|null = null;
            let regCaps: any;
            let registered = false;

            const cleanup = (isError?: string) => {
                if (isError) console.error('[WS]', isError);
                this.allConnections.delete(ws);
                if (workerId) {
                    const cur = this.workers.get(workerId);
                    if (cur?.ws === ws) {
                        if (cur.pid) this.pidMap.delete(cur.pid);
                        this.workers.delete(workerId);
                        this.sessions.unregister(workerId);
                        if (this.queue && this.queue.cancelPollersForWorker) {
                            this.queue.cancelPollersForWorker(workerId);
                        }
                        console.log(`[WS] Disconnected: ${workerId}`);
                    }
                }
            };

            const finalizeReg = (pid?: number, name?: string, jobId?: string, placeId?: number, playerName?: string) => {
                const info = this.workers.get(workerId!);
                if (!info || info.ws !== ws) return;

                if (!pid) {
                    pid = matchRobloxPid(name || info.placeName || '', placeId ?? info.placeId);
                }

                info.pid = pid ?? info.pid;
                info.placeName = name || info.placeName || '';
                info.jobId = jobId || info.jobId || '';
                info.placeId = placeId ?? info.placeId ?? 0;
                info.username = playerName || info.username || 'RobloxPlayerBeta';

                if (info.pid) {
                    const stale = this.pidMap.get(info.pid);
                    if (stale && stale !== workerId) {
                        const s = this.workers.get(stale);
                        if (s) {
                            this.workers.delete(stale);
                            this.sessions.unregister(stale);
                            if (s.ws !== ws) {
                                try { s.ws.close(); } catch {}
                            }
                        }
                    }
                    this.pidMap.set(info.pid, workerId!);
                }

                const displayName = playerName || (info.placeName ? `${info.placeName} (${workerId})` : 'RobloxPlayerBeta');
                this.sessions.register(workerId!, {
                    pid: info.pid,
                    name: displayName,
                    capabilities: regCaps,
                    transport: 'ws'
                });

                if (!registered) {
                    registered = true;
                    this._safeSend(ws, { type: 'registered', worker_id: workerId, pid: info.pid, placeName: info.placeName, jobId: info.jobId, placeId: info.placeId });
                    console.log(`[WS] Registered: ${workerId}${info.pid ? ' pid='+info.pid : ''} "${info.placeName}"`);
                }
            };

            ws.on('message', (raw: any) => {
                if (raw.length > 50 * 1024 * 1024) {
                    console.error('[WS] Payload too large');
                    return;
                }
                let msg: any;
                try { msg = JSON.parse(raw.toString()); } catch { return; }

                switch (msg.type) {
                    case 'register': {
                        workerId = msg.worker_id;
                        if (!workerId) return;
                        regCaps = msg.capabilities;
                        registered = false;

                        const old = this.workers.get(workerId);
                        if (old && old.ws !== ws) {
                            try { old.ws.close(); } catch {}
                        }

                        let targetPid = typeof msg.pid === 'number' && msg.pid > 0 ? msg.pid : undefined;
                        if (!targetPid) {
                            targetPid = matchRobloxPid(msg.placeName || '', msg.placeId);
                        }

                        this.workers.set(workerId, {
                            workerId,
                            pid: targetPid,
                            placeName: msg.placeName || '',
                            jobId: msg.jobId || '',
                            placeId: msg.placeId || 0,
                            username: msg.username || '',
                            ws
                        });

                        // Register immediately in sessions and notify client
                        finalizeReg(targetPid, msg.placeName, msg.jobId, msg.placeId, msg.username);

                        // Also send probe to enrich metadata in the background
                        const identId = `ident_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
                        this._safeSend(ws, { type: 'task', id: identId, tool: 'get-metadata', args: {}, timestamp: Date.now() });
                        break;
                    }

                    case 'result': {
                        if (msg.data?.metadata && workerId) {
                            const info = this.workers.get(workerId);
                            if (info && info.ws === ws) {
                                const m = msg.data.metadata;
                                finalizeReg(matchRobloxPid(m.Name, m.PlaceId), m.Name, m.JobId, m.PlaceId, info.username);
                            }
                        }
                        if (msg.id) this.queue.resolveTask(msg.id, msg.data, msg.error);
                        break;
                    }

                    case 'ping':
                        this._safeSend(ws, { type: 'pong' });
                        break;
                }
            });

            ws.on('close', () => cleanup());
            ws.on('error', (err: any) => cleanup(err?.message || 'Connection error'));
        });

        try {
            this._taskHandler = (task: any) => {
                if (task.targetWorkerId) {
                    const info = this.workers.get(task.targetWorkerId);
                    if (info) {
                        this._safeSend(info.ws, {
                            type: 'task',
                            id: task.id,
                            tool: task.type,
                            args: task.args,
                            timestamp: task.timestamp,
                            workerId: task.targetWorkerId,
                            pid: task.targetPid ?? info.pid,
                        });
                        return;
                    }
                }
                if (task.targetPid) {
                    const wid = this.pidMap.get(Number(task.targetPid));
                    if (!wid) return console.log(`[WS] No worker for PID ${task.targetPid}`);
                    const info = this.workers.get(wid);
                    if (info) this._safeSend(info.ws, { type: 'task', id: task.id, tool: task.type, args: task.args, timestamp: task.timestamp, pid: task.targetPid, workerId: wid });
                } else {
                    let n = 0;
                    for (const ws of this.allConnections) if (this._safeSend(ws, { type: 'task', id: task.id, tool: task.type, args: task.args, timestamp: task.timestamp })) n++;
                    if (n) console.log(`[WS] Broadcast ${task.type} to ${n} connection(s)`);
                }
            };
            (this.queue as any).on('task', this._taskHandler);
        } catch (e: any) { console.error('[WS] listener:', e.message); }

        return this.wss;
    }

    _safeSend(ws: WS, data: object): boolean {
        try { if (ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(data)); return true; } } catch {}
        return false;
    }

    get connectedCount() { return this.workers.size; }

    _startHeartbeat() {
        setInterval(() => {
            try {
                for (const ws of Array.from(this.allConnections)) {
                    if (ws.readyState !== WebSocket.OPEN) { this.allConnections.delete(ws); continue; }
                }
                for (const [wid, info] of Array.from(this.workers.entries())) {
                    if (this.workers.get(wid)?.ws !== info.ws) continue;
                    if (info.ws.readyState !== WebSocket.OPEN) {
                        if (info.pid) this.pidMap.delete(info.pid);
                        this.workers.delete(wid);
                    }
                }
            } catch {}
        }, HEARTBEAT_MS);
    }
}

module.exports = { WsServer };
