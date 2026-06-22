/**
 * ws-server.ts — WebSocket transport for executor communication.
 *
 * Registration: client sends register → server sends get_game_metadata → client replies
 * with metadata → server matches OS PID from window titles → promotes to full registration.
 * Reconnect: same OS PID + new workerId → old worker cleaned up.
 */

import type { Server as HttpServer } from 'http';
const WebSocket = require('ws');

const HEARTBEAT_MS = 30000;
const REGISTER_TIMEOUT_MS = 10000;

type WS = InstanceType<typeof WebSocket>;

function enumWindows() {
    try { return require('./process-manager').enumRobloxWindows(); } catch { return []; }
}

function matchRobloxPid(placeName: string, placeId?: string|number): number|undefined {
    const wins = enumWindows();
    if (!wins?.length) return;
    const name = (placeName || '').toLowerCase();
    const idStr = placeId ? String(placeId) : '';
    for (const w of wins) {
        const t = (w.title || '').toLowerCase();
        // Prefer PlaceId match, then name match, then any Roblox window
        if (!t.includes('roblox')) continue;
        if (idStr && t.includes(idStr)) return w.pid;
        if (name && t.includes(name)) return w.pid;
        return w.pid; // first Roblox window
    }
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
            let regTimer: any = null;
            let regCaps: any;
            let lastPingAt = Date.now();

            const cleanup = (isError?: string) => {
                if (isError) console.error('[WS]', isError);
                this.allConnections.delete(ws);
                if (regTimer) { clearTimeout(regTimer); regTimer = null; }
                if (workerId) {
                    const cur = this.workers.get(workerId);
                    if (cur?.ws === ws) {
                        if (cur.pid) this.pidMap.delete(cur.pid);
                        this.workers.delete(workerId);
                        this.sessions.unregister(workerId);
                        console.log(`[WS] Disconnected: ${workerId}`);
                    }
                }
            };

            const finalizeReg = (pid?: number, name?: string, jobId?: string, placeId?: number) => {
                const info = this.workers.get(workerId!);
                if (!info || info.pid !== undefined) return;
                info.pid = pid;
                info.placeName = name || '';
                info.jobId = jobId || '';
                info.placeId = placeId || 0;
                if (pid) {
                    const stale = this.pidMap.get(pid);
                    if (stale && stale !== workerId) {
                        const s = this.workers.get(stale);
                        if (s) { try { s.ws.close(); } catch {} this.workers.delete(stale); this.sessions.unregister(stale); }
                    }
                    this.pidMap.set(pid, workerId!);
                }
                this.sessions.register(workerId!, { pid, name: 'RobloxPlayerBeta', capabilities: regCaps });
                this._safeSend(ws, { type: 'registered', worker_id: workerId, pid, placeName: name, jobId, placeId });
                console.log(`[WS] Registered: ${workerId}${pid ? ' pid='+pid : ''} "${name}"`);
            };

            ws.on('message', (raw: any) => {
                let msg: any;
                try { msg = JSON.parse(raw.toString()); } catch { return; }

                switch (msg.type) {
                    case 'register': {
                        workerId = msg.worker_id;
                        if (!workerId) return;
                        regCaps = msg.capabilities;

                        const old = this.workers.get(workerId);
                        if (old) { if (old.pid) this.pidMap.delete(old.pid); if (old.ws !== ws) try { old.ws.close(); } catch {} }

                        this.workers.set(workerId, { workerId, pid: undefined, placeName: '', jobId: '', placeId: 0, ws });

                        const identId = `ident_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
                        this._safeSend(ws, { type: 'task', id: identId, tool: 'get_game_metadata', args: {}, timestamp: Date.now() });

                        if (regTimer) clearTimeout(regTimer);
                        regTimer = setTimeout(() => {
                            regTimer = null;
                            finalizeReg(matchRobloxPid(msg.placeName||'', msg.placeId), msg.placeName, msg.jobId, msg.placeId);
                        }, REGISTER_TIMEOUT_MS);
                        break;
                    }

                    case 'result': {
                        if (regTimer && msg.data?.metadata && workerId) {
                            const info = this.workers.get(workerId);
                            if (info && info.pid === undefined) {
                                clearTimeout(regTimer);
                                regTimer = null;
                                const m = msg.data.metadata;
                                finalizeReg(matchRobloxPid(m.Name, m.PlaceId), m.Name, m.JobId, m.PlaceId);
                                return;
                            }
                        }
                        if (msg.id) this.queue.resolveTask(msg.id, msg.data, msg.error);
                        break;
                    }

                    case 'ping':
                        lastPingAt = Date.now();
                        this._safeSend(ws, { type: 'pong' });
                        break;
                }
            });

            ws.on('close', () => cleanup());
            ws.on('error', (err: any) => cleanup(err?.message || 'Connection error'));
        });

        // Task dispatch
        try {
            this._taskHandler = (task: any) => {
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
                const now = Date.now();
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
