"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * session-manager.ts
 *
 * Manages multiple Roblox executor sessions (worker IDs).
 * Each executor registers on first /req poll with a unique workerId.
 * Tasks can target a specific workerId or be unassigned (any worker).
 */
const { v4: uuidv4 } = require('uuid');
class SessionManager {
    constructor() {
        this.sessions = new Map();
        this._startCleanup();
    }
    destroy() {
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
            this._cleanupTimer = undefined;
        }
        this.sessions.clear();
    }
    register(workerId, info) {
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
    unregister(workerId) {
        const session = this.sessions.get(workerId);
        if (session) {
            session.status = 'disconnected';
            session.lastSeen = Date.now();
        }
    }
    get(workerId) {
        return this.sessions.get(workerId);
    }
    listActive() {
        const results = [];
        for (const session of this.sessions.values()) {
            if (session.status === 'active')
                results.push({ ...session });
        }
        return results;
    }
    listAll() {
        return Array.from(this.sessions.values()).map(s => ({ ...s }));
    }
    get activeCount() {
        let count = 0;
        for (const s of this.sessions.values()) {
            if (s.status === 'active')
                count++;
        }
        return count;
    }
    _startCleanup() {
        this._cleanupTimer = setInterval(() => {
            const cutoff = Date.now() - 300000;
            for (const [id, session] of this.sessions.entries()) {
                if (session.lastSeen < cutoff)
                    session.status = 'disconnected';
            }
        }, 120000);
    }
}
module.exports = { SessionManager };
