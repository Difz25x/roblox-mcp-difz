/**
 * ws-server.ts — WebSocket transport for executor communication.
 *
 * Protocol:
 *   Client -> Server: { type: "register", worker_id, placeName, jobId, placeId }
 *   Server -> Client: { type: "task", id, tool, args, pid? }
 *   Client -> Server: { type: "result", id, data, error, pid? }
 *   Server -> Client: { type: "registered", worker_id }
 *
 * Multi-Roblox: every message carries pid for disambiguation.
 * Broadcast: ALL connections receive un-targeted tasks (even pre-registration).
 */

import type { Server as HttpServer } from 'http';

const WebSocket = require('ws');
const WS_HEARTBEAT_INTERVAL = 30000;

type WS = InstanceType<typeof WebSocket>;
type WSData = string | Buffer | ArrayBuffer | Uint8Array;
type WSServer = InstanceType<(typeof WebSocket)['Server']>;

interface QueueManagerLike {
    resolveTask(id: string, data: any, error?: string): boolean;
}
interface SessionManagerLike {
    register(wid: string, info?: { pid?: number; name?: string; capabilities?: Record<string, any> }): any;
    unregister(wid: string): void;
}

function enumWindows() {
    try { return require('./process-manager').enumRobloxWindows(); } catch { return []; }
}

class WsServer {
    queue: QueueManagerLike;
    sessions: SessionManagerLike;
    /** All WS connections (pre and post registration) */
    allConnections: Set<WS>;
    /** Registered workers: workerId -> info */
    workers: Map<string, { workerId: string; pid?: number; placeName: string; jobId: string; ws: WS }>;
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
            // Track ALL connections immediately
            this.allConnections.add(ws);
            let workerId: string | null = null;

            ws.on('message', (raw: WSData) => {
                let msg: any;
                try { msg = JSON.parse(raw.toString()); } catch { return; }

                switch (msg.type) {
                    case 'register':
                        workerId = msg.worker_id;
                        if (!workerId) return;

                        // Remove old
                        const old = this.workers.get(workerId);
                        if (old && old.ws !== ws) { try { old.ws.close(); } catch {} }

                        // Try to match window title -> real OS PID
                        const gameName = (msg.placeName || '').toLowerCase();
                        const windows = enumWindows();
                        let matchedPid: number | undefined;

                        if (gameName && windows.length > 0) {
                            const match = windows.find((w: any) => {
                                const t = (w.title || '').toLowerCase();
                                return t.includes(gameName) && t.includes('roblox');
                            });
                            if (match) matchedPid = match.pid;
                        }

                        const info = {
                            workerId,
                            pid: matchedPid,
                            placeName: msg.placeName || '',
                            jobId: msg.jobId || '',
                            ws,
                        };
                        this.workers.set(workerId, info);
                        if (matchedPid) this.pidMap.set(matchedPid, workerId);
                        this.sessions.register(workerId, { pid: matchedPid, name: 'RobloxPlayerBeta', capabilities: msg.capabilities });

                        this._safeSend(ws, { type: 'registered', worker_id: workerId });
                        console.log(`[WS] Registered: ${workerId} game="${info.placeName}"${matchedPid ? ' pid='+matchedPid : ''}`);

                        // Retry PID matching 3x for slow windows
                        if (!matchedPid && gameName) {
                            let tries = 0;
                            const iv = setInterval(() => {
                                const wins = enumWindows();
                                const found = wins.find((w: any) => (w.title || '').toLowerCase().includes(gameName));
                                if (found && workerId) {
                                    const info2 = this.workers.get(workerId);
                                    if (info2 && !info2.pid) {
                                        info2.pid = found.pid;
                                        this.pidMap.set(found.pid, workerId);
                                        console.log(`[WS] Retry matched ${workerId} -> PID ${found.pid}`);
                                    }
                                    clearInterval(iv);
                                } else if (++tries >= 3) clearInterval(iv);
                            }, 1500);
                        }
                        break;

                    case 'result':
                        if (msg.id) this.queue.resolveTask(msg.id, msg.data, msg.error);
                        break;

                    case 'ping':
                        this._safeSend(ws, { type: 'pong' });
                        break;
                }
            });

            ws.on('close', () => {
                this.allConnections.delete(ws);
                if (workerId) {
                    const info = this.workers.get(workerId);
                    if (info && info.pid) this.pidMap.delete(info.pid);
                    this.workers.delete(workerId);
                    this.sessions.unregister(workerId);
                    console.log(`[WS] Disconnected: ${workerId}`);
                }
            });
            ws.on('error', (err: any) => {
                console.error('[WS] Connection error:', err?.message || err);
                this.allConnections.delete(ws);
                if (workerId) {
                    const info = this.workers.get(workerId);
                    if (info && info.pid) this.pidMap.delete(info.pid);
                    this.workers.delete(workerId);
                    this.sessions.unregister(workerId);
                }
            });
        });

        // Task handler: broadcast to ALL connections
        try {
            this._taskHandler = (task: any) => {
                if (task.targetPid) {
                    // Targeted: send only to specific PID
                    const wid = this.pidMap.get(Number(task.targetPid));
                    if (!wid) { console.log(`[WS] No worker for PID ${task.targetPid}`); return; }
                    const info = this.workers.get(wid);
                    if (info) {
                        const sent = this._safeSend(info.ws, {
                            type: 'task', id: task.id, tool: task.type,
                            args: task.args, timestamp: task.timestamp,
                            pid: task.targetPid, workerId: wid,
                        });
                        if (sent) console.log(`[WS] Sent ${task.type} to PID ${task.targetPid}`);
                    }
                } else {
                    // Broadcast to ALL connections (pre + post registration)
                    let count = 0;
                    for (const ws of this.allConnections) {
                        if (this._safeSend(ws, {
                            type: 'task', id: task.id, tool: task.type,
                            args: task.args, timestamp: task.timestamp,
                        })) count++;
                    }
                    console.log(`[WS] Broadcast ${task.type} to ${count} connection(s)`);
                }
            };
            (this.queue as any).on('task', this._taskHandler);
        } catch (e: any) {
            console.error('[WS] listener:', e.message);
        }

        return this.wss;
    }

    /** Wrap ws.send() in try-catch to prevent crashes from races on socket close. */
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
                // Snapshot to avoid modifying collections during iteration
                for (const ws of Array.from(this.allConnections)) {
                    if (ws.readyState !== WebSocket.OPEN) this.allConnections.delete(ws);
                }
                for (const [wid, info] of Array.from(this.workers.entries())) {
                    if (info.ws.readyState !== WebSocket.OPEN) {
                        if (info.pid) this.pidMap.delete(info.pid);
                        this.workers.delete(wid);
                    }
                }
            } catch (err: any) {
                console.error('[WS] heartbeat error:', err?.message || err);
            }
        }, WS_HEARTBEAT_INTERVAL);
    }
}

module.exports = { WsServer };
