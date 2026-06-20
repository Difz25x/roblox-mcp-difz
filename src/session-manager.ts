/**
 * session-manager.ts
 *
 * Manages multiple Roblox executor sessions (worker IDs).
 * Each executor registers on first /req poll with a unique workerId.
 * Tasks can target a specific workerId or be unassigned (any worker).
 */
const { v4: uuidv4 } = require('uuid');

interface SessionInfo {
    workerId: string;
    pid?: number;
    name?: string;
    firstSeen: number;
    lastSeen: number;
    status: string;
}

interface RegisterInfo {
    pid?: number;
    name?: string;
}

interface RegisterResult {
    workerId: string;
    isNew: boolean;
}

class SessionManager {
    sessions: Map<string, SessionInfo>;

    constructor() {
        this.sessions = new Map();
        this._startCleanup();
    }

    register(workerId: string, info?: RegisterInfo): RegisterResult {
        const existing = this.sessions.get(workerId);
        const isNew = !existing;
        this.sessions.set(workerId, {
            workerId,
            pid: (info && info.pid) || (existing && existing.pid),
            name: (info && info.name) || (existing && existing.name) || '',
            firstSeen: existing ? existing.firstSeen : Date.now(),
            lastSeen: Date.now(),
            status: 'active',
        });
        return { workerId, isNew };
    }

    unregister(workerId: string): void {
        const session = this.sessions.get(workerId);
        if (session) {
            session.status = 'disconnected';
            session.lastSeen = Date.now();
        }
    }

    get(workerId: string): SessionInfo | undefined {
        return this.sessions.get(workerId);
    }

    listActive(): SessionInfo[] {
        const results: SessionInfo[] = [];
        for (const session of this.sessions.values()) {
            if (session.status === 'active') results.push({ ...session });
        }
        return results;
    }

    listAll(): SessionInfo[] {
        return Array.from(this.sessions.values()).map(s => ({ ...s }));
    }

    get activeCount(): number {
        let count = 0;
        for (const s of this.sessions.values()) {
            if (s.status === 'active') count++;
        }
        return count;
    }

    _startCleanup(): void {
        setInterval(() => {
            const cutoff = Date.now() - 300_000;
            for (const [id, session] of this.sessions.entries()) {
                if (session.lastSeen < cutoff) session.status = 'disconnected';
            }
        }, 120_000);
    }
}

module.exports = { SessionManager };
