"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * queue-manager.ts
 *
 * UUID-based async task queue with long-polling support.
 */
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');
class QueueManager extends EventEmitter {
    constructor() {
        super();
        this.taskQueue = [];
        this.pendingResults = new Map();
        this.waitingPollers = [];
        this.totalProcessed = 0;
        this.totalSubmitted = 0;
        this._startCleanupInterval();
    }
    submitTask(type, args = {}, opts) {
        if (typeof opts === 'number')
            opts = { timeoutMs: opts };
        opts = opts || {};
        const timeoutMs = opts.timeoutMs || 60000;
        return new Promise((resolve, reject) => {
            const id = uuidv4();
            const task = { id, type, args, timestamp: Date.now() };
            if (opts.workerId)
                task.targetWorkerId = opts.workerId;
            this.totalSubmitted++;
            const timer = setTimeout(() => {
                this.pendingResults.delete(id);
                this.taskQueue = this.taskQueue.filter(t => t.id !== id);
                reject(new Error(`[MCP Queue] Task '${type}' (${id.slice(0, 8)}…) timed out after ${timeoutMs}ms. Is the executor running?`));
            }, timeoutMs);
            this.pendingResults.set(id, { resolve, reject, timer, submittedAt: Date.now() });
            if (this.waitingPollers.length > 0) {
                const pollerIdx = task.targetWorkerId
                    ? this.waitingPollers.findIndex(p => p.workerId === task.targetWorkerId)
                    : this.waitingPollers.findIndex(p => !p.workerId);
                if (pollerIdx >= 0) {
                    const poller = this.waitingPollers.splice(pollerIdx, 1)[0];
                    clearTimeout(poller.timer);
                    poller.resolve(task);
                    return;
                }
            }
            this.taskQueue.push(task);
        });
    }
    waitForTask(timeout = 25000, workerId) {
        return new Promise((resolve) => {
            if (this.taskQueue.length > 0) {
                const idx = workerId
                    ? this.taskQueue.findIndex(t => !t.targetWorkerId || t.targetWorkerId === workerId)
                    : 0;
                if (idx >= 0) {
                    const task = this.taskQueue.splice(idx, 1)[0];
                    return resolve(task);
                }
            }
            const timer = setTimeout(() => {
                const idx = this.waitingPollers.findIndex(p => p.resolve === resolve);
                if (idx >= 0)
                    this.waitingPollers.splice(idx, 1);
                resolve(null);
            }, timeout);
            this.waitingPollers.push({ resolve, timer, workerId });
        });
    }
    resolveTask(id, data, error) {
        const pending = this.pendingResults.get(id);
        if (!pending)
            return false;
        clearTimeout(pending.timer);
        this.pendingResults.delete(id);
        if (error) {
            pending.reject(new Error(error));
        }
        else {
            this.totalProcessed++;
            pending.resolve(data);
        }
        return true;
    }
    _startCleanupInterval() {
        this._cleanupInterval = setInterval(() => {
            const now = Date.now();
            const staleCutoff = now - 120000;
            const before = this.taskQueue.length;
            this.taskQueue = this.taskQueue.filter(t => t.timestamp >= staleCutoff);
            const cleaned = before - this.taskQueue.length;
            if (cleaned > 0)
                console.log(`[Queue] Cleaned up ${cleaned} stale task(s)`);
            const maxPendingAge = 180000;
            for (const [id, pending] of this.pendingResults.entries()) {
                if (Date.now() - pending.submittedAt > maxPendingAge) {
                    clearTimeout(pending.timer);
                    this.pendingResults.delete(id);
                }
            }
        }, 60000);
    }
    destroy() {
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
            this._cleanupInterval = undefined;
        }
        this.taskQueue = [];
        this.pendingResults.clear();
        this.waitingPollers = [];
    }
    getStats() {
        return {
            pendingQueue: this.taskQueue.length,
            pendingResults: this.pendingResults.size,
            waitingPollers: this.waitingPollers.length,
            totalSubmitted: this.totalSubmitted,
            totalProcessed: this.totalProcessed,
        };
    }
}
module.exports = { QueueManager };
