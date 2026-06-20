/**
 * ws-server.ts — WebSocket transport for executor communication.
 *
 * Default transport (preferred over HTTP polling).
 *
 * Protocol:
 *   Client -> Server: { type: "register", worker_id: "uuid", pid?: number }
 *   Server -> Client: { type: "task", id: "uuid", tool: "name", args: {} }
 *   Client -> Server: { type: "result", id: "uuid", data: any, error?: string }
 *   Server -> Client: { type: "pong" }
 *   Client -> Server: { type: "ping" }
 */
import type { Server as HttpServer } from 'http';

const WebSocket = require('ws');

const WS_HEARTBEAT_INTERVAL = 30000;

type WS = InstanceType<typeof WebSocket>;
type WSData = string | Buffer | ArrayBuffer | Uint8Array;
type WSServer = InstanceType<(typeof WebSocket)['Server']>;

interface TaskPayload {
    id: string;
    type: string;
    args: Record<string, any>;
    timestamp: number;
}

interface QueueManagerLike {
    resolveTask(id: string, data: any, error?: string): boolean;
}

interface SessionManagerLike {
    register(workerId: string, info?: { pid?: number; name?: string }): { workerId: string; isNew: boolean };
    unregister(workerId: string): void;
}

class WsServer {
    queue: QueueManagerLike;
    sessions: SessionManagerLike;
    connections: Map<string, WS>;
    reverseMap: Map<WS, string>;
    wss: WSServer | null;

    constructor(queue: QueueManagerLike, sessions: SessionManagerLike) {
        this.queue = queue;
        this.sessions = sessions;
        this.connections = new Map();
        this.reverseMap = new Map();
        this.wss = null;
        this._startHeartbeat();
    }

    /**
     * Mount on an HTTP server.
     */
    mount(server: HttpServer): WSServer {
        this.wss = new WebSocket.Server({ server, path: '/ws' });

        this.wss.on('connection', (ws: WS) => {
            let workerId: string | null = null;

            ws.on('message', (raw: WSData) => {
                let msg: any;
                try { msg = JSON.parse(raw.toString()); } catch { return; }

                switch (msg.type) {
                    case 'register':
                        workerId = msg.worker_id;
                        if (!workerId) return;
                        const oldWs = this.connections.get(workerId);
                        if (oldWs && oldWs !== ws) { try { oldWs.close(); } catch {} }
                        this.connections.set(workerId, ws);
                        this.reverseMap.set(ws, workerId);
                        this.sessions.register(workerId, { pid: msg.pid || msg.pid, name: 'RobloxPlayerBeta' });
                        ws.send(JSON.stringify({ type: 'registered', worker_id: workerId }));
                        break;
                    case 'result':
                        if (msg.id) this.queue.resolveTask(msg.id, msg.data, msg.error);
                        break;
                    case 'ping':
                        ws.send(JSON.stringify({ type: 'pong' }));
                        break;
                }
            });

            ws.on('close', () => {
                if (workerId) { this.connections.delete(workerId); this.reverseMap.delete(ws); this.sessions.unregister(workerId); }
            });
            ws.on('error', () => {
                if (workerId) { this.connections.delete(workerId); this.reverseMap.delete(ws); }
            });
        });

        return this.wss;
    }

    sendTask(task: TaskPayload, workerId?: string): boolean {
        if (workerId) {
            const ws = this.connections.get(workerId);
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'task', id: task.id, tool: task.type, args: task.args, timestamp: task.timestamp }));
                return true;
            }
            return false;
        }
        for (const ws of this.connections.values()) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'task', id: task.id, tool: task.type, args: task.args, timestamp: task.timestamp }));
                return true;
            }
        }
        return false;
    }

    get connectedCount(): number { return this.connections.size; }

    _startHeartbeat(): void {
        setInterval(() => {
            for (const [wid, ws] of this.connections.entries()) {
                if (ws.readyState !== WebSocket.OPEN) { this.connections.delete(wid); this.reverseMap.delete(ws); }
            }
        }, WS_HEARTBEAT_INTERVAL);
    }
}

module.exports = { WsServer };
