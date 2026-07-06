


interface SessionInfo {
    workerId: string;
    pid?: string | number;
    name?: string;
    firstSeen: number;
    lastSeen: number;
    status: string;
    capabilities?: Record<string, any>;
}

interface RegisterInfo {
    pid?: string | number;
    name?: string;
    capabilities?: Record<string, any>;
}

interface RegisterResult {
    workerId: string;
    isNew: boolean;
}

class SessionManager {
    sessions: Map<string, SessionInfo>;
    private _cleanupTimer?: NodeJS.Timeout;

    constructor() {
        this.sessions = new Map();
        this._startCleanup();
    }

    destroy(): void {
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
            this._cleanupTimer = undefined;
        }
        this.sessions.clear();
    }

    register(workerId: string, info?: RegisterInfo): RegisterResult {
        const existing = this.sessions.get(workerId);
        const isNew = !existing;
        this.sessions.set(workerId, {
            workerId,
            pid: info?.pid ?? existing?.pid,
            name: info?.name ?? existing?.name ?? '',
            firstSeen: existing ? existing.firstSeen : Date.now(),
            lastSeen: Date.now(),
            status: 'active',
            capabilities: info?.capabilities ?? existing?.capabilities,
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

    private _startCleanup(): void {
        this._cleanupTimer = setInterval(() => {
            const now = Date.now();
            const disconnectCutoff = now - 300_000;
            const purgeCutoff = now - 3600_000; // 1 hour

            for (const [id, session] of Array.from(this.sessions.entries())) {
                if (session.lastSeen < purgeCutoff) {
                    this.sessions.delete(id);
                }
            }
        }, 120_000);
        if (this._cleanupTimer.unref) this._cleanupTimer.unref();
    }
}

module.exports = { SessionManager };
