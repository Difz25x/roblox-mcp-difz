/**
 * ws-server.ts — WebSocket transport for executor communication.
 *
 * Registration flow (per connection):
 *   1. Client connects WS → allConnections.add(ws)
 *   2. Client sends { type: "register", worker_id, capabilities }
 *   3. Server sends { type: "task", id, tool: "get_game_metadata" } to THIS ws only
 *   4. Client executes → sends back { type: "result", id, data: { metadata: { PlaceId, JobId, Name } } }
 *   5. Server receives metadata → uses placeName to match via enumWindows() → gets real OS PID
 *   6. If same PID belongs to a different workerId, old worker is stale (reconnect) → cleanup
 *   7. Server promotes to full registration, sends { type: "registered", worker_id, pid (OS PID),
 *      placeName, jobId, placeId }
 *
 * Task dispatch:
 *   - Broadcast (no pid): send to ALL connections (allConnections)
 *   - Targeted (number pid): send via pidMap (OS PID → workerId) → ws
 *
 * Multi-Roblox: each instance gets its own OS PID as identifier.
 * Reconnect: same OS PID + different workerId → old worker cleaned up first.
 */

import type { Server as HttpServer } from 'http';

const WebSocket = require('ws');
const WS_HEARTBEAT_INTERVAL = 30000;
const REGISTER_TIMEOUT_MS = 10000;

type WS = InstanceType<typeof WebSocket>;
type WSData = string | Buffer | ArrayBuffer | Uint8Array;
type WSServer = InstanceType<(typeof WebSocket)['Server']>;

interface QueueManagerLike {
    resolveTask(id: string, data: any, error?: string): boolean;
}
interface SessionManagerLike {
    register(wid: string, info?: { pid?: number | string; name?: string; capabilities?: Record<string, any> }): any;
    unregister(wid: string): void;
}

function enumWindows() {
    try { return require('./process-manager').enumRobloxWindows(); } catch { return []; }
}

/** Match a Roblox window by placeName, returns the OS PID or undefined. */
function matchRobloxPid(placeName: string, placeId?: number): number | undefined {
    const wins = enumWindows();
    if (!wins || wins.length === 0) return undefined;
    const name = (placeName || '').toLowerCase();
    const idStr = placeId ? String(placeId) : '';

    for (const w of wins) {
        const title = (w.title || '').toLowerCase();
        if (!title.includes('roblox')) continue;
        // Exact match by PlaceId (most reliable)
        if (idStr && title.includes(idStr)) return w.pid;
    }
    // Fallback: match by placeName
    if (name) {
        for (const w of wins) {
            const title = (w.title || '').toLowerCase();
            if (title.includes('roblox') && title.includes(name)) return w.pid;
        }
    }
    // Last resort: first Roblox window
    if (wins.length > 0) return wins[0].pid;
    return undefined;
}

interface WorkerInfo {
    workerId: string;
    pid?: number;        // real OS PID
    placeName: string;
    jobId: string;
    placeId: number;
    ws: WS;
}

class WsServer {
    queue: QueueManagerLike;
    sessions: SessionManagerLike;
    /** All WS connections (pre and post registration) */
    allConnections: Set<WS>;
    /** Registered workers: workerId -> info */
    workers: Map<string, WorkerInfo>;
    /** OS PID -> workerId */
    pidMap: Map<number, string>;
    wss: WSServer | null;
    _taskHandler: ((task: any) => void) | null;

    constructor(queue: QueueManagerLike, sessions: SessionManagerLike) {
        this.queue = queue;
        this.sessions = sessions;
        this.allConnections = new Set();
        this.workers = new Map();
        this.pidMap = new Map();
        this.wss = null;
        this._taskHandler = null;
        this._startHeartbeat();
    }

    mount(server: HttpServer): WSServer {
        this.wss = new WebSocket.Server({ server, path: '/ws' });

        this.wss.on('connection', (ws: WS) => {
            this.allConnections.add(ws);
            let workerId: string | null = null;
            let registerTimer: ReturnType<typeof setTimeout> | null = null;
            let registerCapabilities: Record<string, any> | undefined;

            ws.on('message', (raw: WSData) => {
                let msg: any;
                try { msg = JSON.parse(raw.toString()); } catch { return; }

                switch (msg.type) {
                    case 'register': {
                        workerId = msg.worker_id;
                        if (!workerId) return;
                        registerCapabilities = msg.capabilities;

                        // Remove old entry with same workerId (reconnect with new WS)
                        const existing = this.workers.get(workerId);
                        if (existing) {
                            if (existing.pid) this.pidMap.delete(existing.pid);
                            if (existing.ws !== ws) { try { existing.ws.close(); } catch {} }
                        }

                        // Create temp entry until identity is resolved with real OS PID
                        this.workers.set(workerId, { workerId, pid: undefined, placeName: '', jobId: '', placeId: 0, ws });

                        // Send identity request ONLY to this connection
                        const identId = `ident_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                        this._safeSend(ws, {
                            type: 'task', id: identId, tool: 'get_game_metadata',
                            args: {}, timestamp: Date.now(),
                        });
                        console.log(`[WS] Identity requested: ${workerId} (${identId})`);

                        // Timeout: if no metadata response, try partial match
                        if (registerTimer) clearTimeout(registerTimer);
                        registerTimer = setTimeout(() => {
                            registerTimer = null;
                            const info = this.workers.get(workerId!);
                            if (!info || info.pid) return; // already resolved

                            // Try to match PID with whatever we know
                            const matchedPid = matchRobloxPid(msg.placeName || '', msg.placeId);
                            info.pid = matchedPid;
                            info.placeName = msg.placeName || '';
                            info.jobId = msg.jobId || '';
                            info.placeId = msg.placeId || 0;
                            if (matchedPid) this.pidMap.set(matchedPid, workerId!);
                            this.sessions.register(workerId!, { pid: matchedPid, name: 'RobloxPlayerBeta', capabilities: registerCapabilities });
                            this._safeSend(ws, { type: 'registered', worker_id: workerId, pid: matchedPid, placeName: info.placeName });
                            console.log(`[WS] Registered (timeout): ${workerId}${matchedPid ? ' pid='+matchedPid : ''}`);
                        }, REGISTER_TIMEOUT_MS);
                        break;
                    }

                    case 'result': {
                        // Identity response? timer active + worker still temp (no pid set yet)
                        if (registerTimer && msg.data?.metadata) {
                            const regInfo = this.workers.get(workerId!);
                            if (regInfo && regInfo.pid === undefined) {
                                clearTimeout(registerTimer);
                                registerTimer = null;

                                const meta = msg.data.metadata;
                                const placeName = meta.Name || msg.placeName || '';
                                const osPid = matchRobloxPid(placeName, meta.PlaceId);

                                // If same OS PID belongs to a different worker, old one is stale (reconnect)
                                if (osPid) {
                                    const staleWid = this.pidMap.get(osPid);
                                    if (staleWid && staleWid !== workerId) {
                                        const staleInfo = this.workers.get(staleWid);
                                        if (staleInfo) {
                                            console.log(`[WS] Stale ${staleWid} replaced by ${workerId} (same PID ${osPid})`);
                                            try { staleInfo.ws.close(); } catch {}
                                            this.workers.delete(staleWid);
                                            this.sessions.unregister(staleWid);
                                        }
                                    }
                                }

                                // Update temp entry with real identity + OS PID
                                if (regInfo.pid && regInfo.pid !== osPid) this.pidMap.delete(regInfo.pid);
                                regInfo.pid = osPid;
                                regInfo.placeName = placeName;
                                regInfo.jobId = meta.JobId || '';
                                regInfo.placeId = meta.PlaceId || 0;

                                if (osPid) this.pidMap.set(osPid, workerId!);
                                this.sessions.register(workerId!, { pid: osPid, name: 'RobloxPlayerBeta', capabilities: registerCapabilities });

                                this._safeSend(ws, {
                                    type: 'registered',
                                    worker_id: workerId,
                                    pid: osPid,
                                    placeName: placeName,
                                    jobId: meta.JobId || '',
                                    placeId: meta.PlaceId,
                                });
                                console.log(`[WS] Registered: ${workerId} -> "${placeName}"${osPid ? ' pid='+osPid : ''}`);
                                return; // identity results DON'T go through queue
                            }
                        }

                        // Normal task result → resolve queue
                        if (msg.id) this.queue.resolveTask(msg.id, msg.data, msg.error);
                        break;
                    }

                    case 'ping':
                        this._safeSend(ws, { type: 'pong' });
                        break;
                }
            });

            ws.on('close', () => {
                this.allConnections.delete(ws);
                if (registerTimer) { clearTimeout(registerTimer); registerTimer = null; }
                if (workerId) {
                    const current = this.workers.get(workerId);
                    if (current && current.ws === ws) {
                        if (current.pid) this.pidMap.delete(current.pid);
                        this.workers.delete(workerId);
                        this.sessions.unregister(workerId);
                        console.log(`[WS] Disconnected: ${workerId}`);
                    }
                }
            });
            ws.on('error', (err: any) => {
                console.error('[WS] Connection error:', err?.message || err);
                this.allConnections.delete(ws);
                if (registerTimer) { clearTimeout(registerTimer); registerTimer = null; }
                if (workerId) {
                    const current = this.workers.get(workerId);
                    if (current && current.ws === ws) {
                        if (current.pid) this.pidMap.delete(current.pid);
                        this.workers.delete(workerId);
                        this.sessions.unregister(workerId);
                    }
                }
            });
        });

        // Task handler: broadcast or pid-targeted
        try {
            this._taskHandler = (task: any) => {
                if (task.targetPid) {
                    const pidNum = Number(task.targetPid);
                    const wid = this.pidMap.get(pidNum);
                    if (!wid) { console.log(`[WS] No worker for PID ${pidNum}`); return; }
                    const info = this.workers.get(wid);
                    if (info) {
                        this._safeSend(info.ws, {
                            type: 'task', id: task.id, tool: task.type,
                            args: task.args, timestamp: task.timestamp,
                            pid: pidNum, workerId: wid,
                        });
                        console.log(`[WS] Sent ${task.type} to PID ${pidNum}`);
                    }
                } else {
                    let count = 0;
                    for (const ws of this.allConnections) {
                        if (this._safeSend(ws, {
                            type: 'task', id: task.id, tool: task.type,
                            args: task.args, timestamp: task.timestamp,
                        })) count++;
                    }
                    if (count) console.log(`[WS] Broadcast ${task.type} to ${count} connection(s)`);
                }
            };
            (this.queue as any).on('task', this._taskHandler);
        } catch (e: any) {
            console.error('[WS] listener:', e.message);
        }

        return this.wss;
    }

    /** Wrap ws.send() in try-catch */
    _safeSend(ws: WS, data: object): boolean {
        try {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(data));
                return true;
            }
        } catch (err: any) {
            console.error('[WS] send error:', err?.message || err);
        }
        return false;
    }

    get connectedCount(): number { return this.workers.size; }

    _startHeartbeat(): void {
        setInterval(() => {
            try {
                for (const ws of Array.from(this.allConnections)) {
                    if (ws.readyState !== WebSocket.OPEN) this.allConnections.delete(ws);
                }
                for (const [wid, info] of Array.from(this.workers.entries())) {
                    if (info.ws.readyState !== WebSocket.OPEN) {
                        if (this.workers.get(wid)?.ws === info.ws) {
                            if (info.pid) this.pidMap.delete(info.pid);
                            this.workers.delete(wid);
                        }
                    }
                }
            } catch {} // heartbeat must never crash
        }, WS_HEARTBEAT_INTERVAL);
    }
}

module.exports = { WsServer };
