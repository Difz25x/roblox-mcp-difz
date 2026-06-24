
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');

interface Task {
    id: string;
    type: string;
    args: Record<string, any>;
    timestamp: number;
    targetWorkerId?: string;
    targetPid?: number;
}

interface PendingResult {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timer: NodeJS.Timeout;
    submittedAt: number;
}

interface WaitingPoller {
    resolve: (value: any) => void;
    timer: NodeJS.Timeout;
    workerId?: string;
}

interface SubmitTaskOpts {
    timeoutMs?: number;
    workerId?: string;
    targetPid?: number;
}

class QueueManager extends EventEmitter {
    taskQueue: Task[];
    pendingResults: Map<string, PendingResult>;
    waitingPollers: WaitingPoller[];
    totalProcessed: number;
    totalSubmitted: number;
    private _cleanupInterval?: NodeJS.Timeout;

    constructor() {
        super();
        this.taskQueue = [];
        this.pendingResults = new Map();
        this.waitingPollers = [];
        this.totalProcessed = 0;
        this.totalSubmitted = 0;
        this._startCleanupInterval();
    }

    
    submitTask(type: string, args: Record<string, any> = {}, opts?: SubmitTaskOpts | number): Promise<any> {
        if (typeof opts === 'number') opts = { timeoutMs: opts }; 
        opts = opts || {};
        const timeoutMs = opts.timeoutMs || 60000;
        return new Promise<any>((resolve, reject) => {
            const id = uuidv4();
            const task: Task = { id, type, args, timestamp: Date.now() };
            if (opts.workerId) task.targetWorkerId = opts.workerId;
            if (opts.targetPid) task.targetPid = opts.targetPid;
            this.totalSubmitted++;

            
            const timer = setTimeout(() => {
                this.pendingResults.delete(id);
                
                this.taskQueue = this.taskQueue.filter(t => t.id !== id);
                reject(new Error(
                    `[MCP Queue] Task '${type}' (${id.slice(0, 8)}…) timed out after ${timeoutMs}ms. ` +
                    `Is the executor running?`
                ));
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
            this.emit('task', task);
            return;
        });
    }

    
    waitForTask(timeout: number = 25000, workerId?: string): Promise<Task | null> {
        return new Promise<Task | null>((resolve) => {
            
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
                if (idx >= 0) this.waitingPollers.splice(idx, 1);
                resolve(null); 
            }, timeout);

            this.waitingPollers.push({ resolve, timer, workerId });
        });
    }

    
    resolveTask(id: string, data: any, error?: string): boolean {
        const pending = this.pendingResults.get(id);
        if (!pending) return false;

        clearTimeout(pending.timer);
        this.pendingResults.delete(id);

        if (error) {
            pending.reject(new Error(error));
        } else {
            this.totalProcessed++;
            pending.resolve(data);
        }
        return true;
    }

    
    private _startCleanupInterval(): void {
        this._cleanupInterval = setInterval(() => {
            const now = Date.now();
            const staleCutoff = now - 120_000;

            
            const before = this.taskQueue.length;
            this.taskQueue = this.taskQueue.filter(t => t.timestamp >= staleCutoff);
            const cleaned = before - this.taskQueue.length;
            if (cleaned > 0) {
                console.log(`[Queue] Cleaned up ${cleaned} stale task(s)`);
            }

            
            const maxPendingAge = 180_000;
            for (const [id, pending] of this.pendingResults.entries()) {
                if (Date.now() - pending.submittedAt > maxPendingAge) {
                    clearTimeout(pending.timer);
                    pending.reject(new Error(`[MCP Queue] Task (${id.slice(0, 8)}…) exceeded maximum pending age (${maxPendingAge}ms)`));
                    this.pendingResults.delete(id);
                }
            }
        }, 60_000);
    }

    
    getStats(): { pendingQueue: number; pendingResults: number; waitingPollers: number; totalSubmitted: number; totalProcessed: number } {
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
