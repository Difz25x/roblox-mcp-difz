import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.roblox-mcp');
const DEBUG_DIR = path.join(CONFIG_DIR, 'debug-memory');
const INDEX_FILE = path.join(DEBUG_DIR, 'sessions.json');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface DebugEvent {
    id: string;
    timestamp: number;
    isoTime: string;
    type: 'tool_action' | 'session_connect' | 'session_disconnect' | 'server_action';
    execution: 'client' | 'server';
    status: 'success' | 'error' | 'pending';
    sessionId: string;
    pid?: number;
    playerName?: string;
    tool?: string;
    durationMs?: number;
    arguments?: Record<string, unknown>;
    result?: unknown;
    error?: string;
    meta?: Record<string, unknown>;
}

export interface DebugSessionMeta {
    sessionId: string;
    pid?: number;
    playerName?: string;
    placeId?: string | number;
    jobId?: string;
    placeName?: string;
    transport?: 'ws' | 'stream';
    startTime: number;
    lastActivityTime: number;
    status: 'active' | 'disconnected';
    eventCount: number;
    toolCallCount: number;
    errorCount: number;
}

function sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9_\-\.]/g, '_').slice(0, 80);
}

class DebugManager {
    private enabled: boolean;
    private sessionsIndex: Map<string, DebugSessionMeta>;
    private sessionEventsCache: Map<string, DebugEvent[]>;
    private pendingEvents: Map<string, DebugEvent>;
    private writeDebounceTimers: Map<string, NodeJS.Timeout>;

    constructor() {
        this.sessionsIndex = new Map();
        this.sessionEventsCache = new Map();
        this.pendingEvents = new Map();
        this.writeDebounceTimers = new Map();

        this.enabled = this._loadInitialConfig();
        this._ensureDirectories();
        this._loadSessionsIndex();
    }

    private _ensureDirectories(): void {
        try {
            if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
            if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });
        } catch {}
    }

    private _loadInitialConfig(): boolean {
        try {
            if (fs.existsSync(CONFIG_FILE)) {
                const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
                if (typeof cfg.debugLogging === 'boolean') {
                    return cfg.debugLogging;
                }
            }
        } catch {}
        return true;
    }

    private _saveConfig(): void {
        try {
            let cfg: Record<string, any> = {};
            if (fs.existsSync(CONFIG_FILE)) {
                try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch {}
            }
            cfg.debugLogging = this.enabled;
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
        } catch {}
    }

    private _loadSessionsIndex(): void {
        try {
            if (fs.existsSync(INDEX_FILE)) {
                const data = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
                if (Array.isArray(data)) {
                    for (const s of data) {
                        if (s && s.sessionId) {
                            this.sessionsIndex.set(s.sessionId, s);
                        }
                    }
                }
            }
        } catch {}
    }

    private _persistSessionsIndex(): void {
        try {
            this._ensureDirectories();
            const list = Array.from(this.sessionsIndex.values());
            fs.writeFileSync(INDEX_FILE, JSON.stringify(list, null, 2), 'utf-8');
        } catch {}
    }

    private _getSessionFilePath(sessionId: string): string {
        return path.join(DEBUG_DIR, `sess_${sanitizeFilename(sessionId)}.json`);
    }

    private _loadEventsForSession(sessionId: string): DebugEvent[] {
        if (this.sessionEventsCache.has(sessionId)) {
            return this.sessionEventsCache.get(sessionId)!;
        }

        const filePath = this._getSessionFilePath(sessionId);
        let events: DebugEvent[] = [];
        try {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf-8');
                events = JSON.parse(content);
                if (!Array.isArray(events)) events = [];
            }
        } catch {}

        this.sessionEventsCache.set(sessionId, events);
        return events;
    }

    private _saveSessionEventsDebounced(sessionId: string): void {
        if (this.writeDebounceTimers.has(sessionId)) {
            clearTimeout(this.writeDebounceTimers.get(sessionId)!);
        }

        const timer = setTimeout(() => {
            this.writeDebounceTimers.delete(sessionId);
            try {
                this._ensureDirectories();
                const events = this._loadEventsForSession(sessionId);
                const filePath = this._getSessionFilePath(sessionId);
                fs.writeFileSync(filePath, JSON.stringify(events, null, 2), 'utf-8');
                this._persistSessionsIndex();
            } catch {}
        }, 150);

        this.writeDebounceTimers.set(sessionId, timer);
    }

    public isEnabled(): boolean {
        return this.enabled;
    }

    public setEnabled(val: boolean): boolean {
        this.enabled = !!val;
        this._saveConfig();
        return this.enabled;
    }

    public getStatus(): { enabled: boolean; totalSessions: number; totalEvents: number; storagePath: string } {
        let totalEvents = 0;
        for (const meta of this.sessionsIndex.values()) {
            totalEvents += meta.eventCount || 0;
        }
        return {
            enabled: this.enabled,
            totalSessions: this.sessionsIndex.size,
            totalEvents,
            storagePath: DEBUG_DIR,
        };
    }

    public getOrCreateSessionMeta(sessionId: string, info?: Partial<DebugSessionMeta>): DebugSessionMeta {
        let meta = this.sessionsIndex.get(sessionId);
        if (!meta) {
            meta = {
                sessionId,
                pid: info?.pid,
                playerName: info?.playerName || '',
                placeId: info?.placeId,
                jobId: info?.jobId,
                placeName: info?.placeName,
                transport: info?.transport || 'ws',
                startTime: Date.now(),
                lastActivityTime: Date.now(),
                status: 'active',
                eventCount: 0,
                toolCallCount: 0,
                errorCount: 0,
            };
            this.sessionsIndex.set(sessionId, meta);
        } else {
            if (info?.pid && !meta.pid) meta.pid = info.pid;
            if (info?.playerName && !meta.playerName) meta.playerName = info.playerName;
            if (info?.placeId && !meta.placeId) meta.placeId = info.placeId;
            if (info?.jobId && !meta.jobId) meta.jobId = info.jobId;
            if (info?.placeName && !meta.placeName) meta.placeName = info.placeName;
            if (info?.transport) meta.transport = info.transport;
        }
        return meta;
    }

    public recordSessionConnect(sessionId: string, info?: { pid?: string | number; name?: string; transport?: 'ws' | 'stream'; capabilities?: any }): void {
        if (!this.enabled) return;

        const pidNum = info?.pid !== undefined ? Number(info.pid) : undefined;
        const meta = this.getOrCreateSessionMeta(sessionId, {
            pid: isNaN(pidNum as any) ? undefined : pidNum,
            playerName: info?.name,
            transport: info?.transport,
        });
        meta.status = 'active';
        meta.lastActivityTime = Date.now();

        const event: DebugEvent = {
            id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            timestamp: Date.now(),
            isoTime: new Date().toISOString(),
            type: 'session_connect',
            execution: 'client',
            status: 'success',
            sessionId,
            pid: meta.pid,
            playerName: meta.playerName,
            arguments: info ? { pid: info.pid, name: info.name, transport: info.transport, capabilities: info.capabilities } : {},
            result: { connected: true, transport: info?.transport || 'ws', timestamp: Date.now() },
            meta: { transport: info?.transport || 'ws' },
        };

        this._addEvent(sessionId, event);
    }

    public recordSessionDisconnect(sessionId: string): void {
        const meta = this.sessionsIndex.get(sessionId);
        if (meta) {
            meta.status = 'disconnected';
            meta.lastActivityTime = Date.now();
        }

        if (!this.enabled) return;

        const event: DebugEvent = {
            id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            timestamp: Date.now(),
            isoTime: new Date().toISOString(),
            type: 'session_disconnect',
            execution: 'client',
            status: 'success',
            sessionId,
            pid: meta?.pid,
            playerName: meta?.playerName,
            arguments: { sessionId, playerName: meta?.playerName, pid: meta?.pid },
            result: { disconnected: true, timestamp: Date.now() },
        };

        this._addEvent(sessionId, event);
    }

    public startToolCall(
        tool: string,
        args: Record<string, unknown>,
        opts: { sessionId?: string; pid?: number; caller?: string; execution?: 'client' | 'server' }
    ): string {
        const eventId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        if (!this.enabled) return eventId;

        const targetSessionId = opts.sessionId || (opts.pid ? `roblox_pid_${opts.pid}` : 'server');
        const meta = this.getOrCreateSessionMeta(targetSessionId, { pid: opts.pid });
        meta.lastActivityTime = Date.now();
        meta.toolCallCount = (meta.toolCallCount || 0) + 1;

        const execution: 'client' | 'server' = opts.execution || (targetSessionId === 'server' ? 'server' : 'client');

        const event: DebugEvent = {
            id: eventId,
            timestamp: Date.now(),
            isoTime: new Date().toISOString(),
            type: 'tool_action',
            execution,
            status: 'pending',
            sessionId: targetSessionId,
            pid: opts.pid || meta.pid,
            playerName: meta.playerName,
            tool,
            arguments: args ? { ...args } : {},
            meta: opts.caller ? { caller: opts.caller } : undefined,
        };

        this.pendingEvents.set(eventId, event);
        this._addEvent(targetSessionId, event);
        return eventId;
    }

    public endToolResult(
        eventId: string,
        result: unknown,
        durationMs: number
    ): void {
        if (!this.enabled) return;

        const pending = this.pendingEvents.get(eventId);
        this.pendingEvents.delete(eventId);

        const sessionId = pending?.sessionId || 'server';
        const meta = this.getOrCreateSessionMeta(sessionId);
        meta.lastActivityTime = Date.now();

        let cleanResult = result;
        if (typeof cleanResult === 'string' && cleanResult.length > 30000) {
            cleanResult = cleanResult.slice(0, 30000) + '... [truncated for debug memory]';
        }

        const events = this._loadEventsForSession(sessionId);
        const existingEvent = events.find(e => e.id === eventId);
        if (existingEvent) {
            existingEvent.status = 'success';
            existingEvent.result = cleanResult;
            existingEvent.durationMs = durationMs;
        } else {
            const event: DebugEvent = {
                id: eventId,
                timestamp: Date.now(),
                isoTime: new Date().toISOString(),
                type: 'tool_action',
                execution: pending?.execution || 'server',
                status: 'success',
                sessionId,
                pid: pending?.pid || meta.pid,
                playerName: meta.playerName,
                tool: pending?.tool,
                durationMs,
                arguments: pending?.arguments || {},
                result: cleanResult,
            };
            this._addEvent(sessionId, event);
        }

        this._saveSessionEventsDebounced(sessionId);
    }

    public endToolError(
        eventId: string,
        error: string,
        durationMs: number
    ): void {
        if (!this.enabled) return;

        const pending = this.pendingEvents.get(eventId);
        this.pendingEvents.delete(eventId);

        const sessionId = pending?.sessionId || 'server';
        const meta = this.getOrCreateSessionMeta(sessionId);
        meta.lastActivityTime = Date.now();
        meta.errorCount = (meta.errorCount || 0) + 1;

        const events = this._loadEventsForSession(sessionId);
        const existingEvent = events.find(e => e.id === eventId);
        if (existingEvent) {
            existingEvent.status = 'error';
            existingEvent.error = error || 'Unknown tool error';
            existingEvent.durationMs = durationMs;
        } else {
            const event: DebugEvent = {
                id: eventId,
                timestamp: Date.now(),
                isoTime: new Date().toISOString(),
                type: 'tool_action',
                execution: pending?.execution || 'server',
                status: 'error',
                sessionId,
                pid: pending?.pid || meta.pid,
                playerName: meta.playerName,
                tool: pending?.tool,
                durationMs,
                arguments: pending?.arguments || {},
                error: error || 'Unknown tool error',
            };
            this._addEvent(sessionId, event);
        }

        this._saveSessionEventsDebounced(sessionId);
    }

    private _addEvent(sessionId: string, event: DebugEvent): void {
        const events = this._loadEventsForSession(sessionId);
        events.push(event);

        if (events.length > 2000) {
            events.splice(0, events.length - 2000);
        }

        const meta = this.getOrCreateSessionMeta(sessionId);
        meta.eventCount = events.length;
        meta.lastActivityTime = event.timestamp;

        this._saveSessionEventsDebounced(sessionId);
    }

    public listSessions(filter?: { status?: string; limit?: number }): DebugSessionMeta[] {
        let list = Array.from(this.sessionsIndex.values());

        if (filter?.status && filter.status !== 'all') {
            list = list.filter(s => s.status === filter.status);
        }

        list.sort((a, b) => b.lastActivityTime - a.lastActivityTime);

        if (filter?.limit && filter.limit > 0) {
            list = list.slice(0, filter.limit);
        }

        return list;
    }

    public getSessionEvents(
        sessionId: string,
        filter?: { tool?: string; status?: string; execution?: string; limit?: number; offset?: number; search?: string }
    ): { total: number; sessionId: string; meta?: DebugSessionMeta; events: DebugEvent[] } {
        const meta = this.sessionsIndex.get(sessionId);
        let events = this._loadEventsForSession(sessionId);

        if (filter?.tool) {
            const toolLower = filter.tool.toLowerCase();
            events = events.filter(e => e.tool && e.tool.toLowerCase().includes(toolLower));
        }

        if (filter?.status) {
            if (filter.status === 'error') {
                events = events.filter(e => e.status === 'error');
            } else if (filter.status === 'success') {
                events = events.filter(e => e.status === 'success');
            } else if (filter.status === 'pending') {
                events = events.filter(e => e.status === 'pending');
            }
        }

        if (filter?.execution && filter.execution !== 'all') {
            events = events.filter(e => e.execution === filter.execution);
        }

        if (filter?.search) {
            const searchLower = filter.search.toLowerCase();
            events = events.filter(e =>
                (e.tool && e.tool.toLowerCase().includes(searchLower)) ||
                (e.error && e.error.toLowerCase().includes(searchLower)) ||
                (e.arguments && JSON.stringify(e.arguments).toLowerCase().includes(searchLower)) ||
                (e.result && JSON.stringify(e.result).toLowerCase().includes(searchLower))
            );
        }

        const total = events.length;
        const offset = filter?.offset || 0;
        const limit = filter?.limit || 100;

        const sorted = [...events].reverse();
        const paged = sorted.slice(offset, offset + limit);

        return {
            total,
            sessionId,
            meta,
            events: paged,
        };
    }

    public getAllRecentEvents(limit: number = 50, filter?: { search?: string; status?: string; execution?: string }): DebugEvent[] {
        const all: DebugEvent[] = [];
        for (const s of this.sessionsIndex.values()) {
            const evts = this._loadEventsForSession(s.sessionId);
            all.push(...evts);
        }

        let filtered = all;
        if (filter?.status === 'error') {
            filtered = filtered.filter(e => e.status === 'error');
        } else if (filter?.status === 'success') {
            filtered = filtered.filter(e => e.status === 'success');
        } else if (filter?.status === 'pending') {
            filtered = filtered.filter(e => e.status === 'pending');
        }

        if (filter?.execution && filter.execution !== 'all') {
            filtered = filtered.filter(e => e.execution === filter.execution);
        }

        if (filter?.search) {
            const q = filter.search.toLowerCase();
            filtered = filtered.filter(e =>
                (e.tool && e.tool.toLowerCase().includes(q)) ||
                (e.sessionId && e.sessionId.toLowerCase().includes(q)) ||
                (e.error && e.error.toLowerCase().includes(q)) ||
                (e.arguments && JSON.stringify(e.arguments).toLowerCase().includes(q)) ||
                (e.result && JSON.stringify(e.result).toLowerCase().includes(q))
            );
        }

        filtered.sort((a, b) => b.timestamp - a.timestamp);
        return filtered.slice(0, limit);
    }

    public clearHistory(sessionId?: string): { success: boolean; clearedCount: number } {
        let clearedCount = 0;

        if (sessionId) {
            const targetMeta = this.sessionsIndex.get(sessionId);
            if (targetMeta) {
                clearedCount = targetMeta.eventCount || 1;
                this.sessionsIndex.delete(sessionId);
                this.sessionEventsCache.delete(sessionId);
                try {
                    const filePath = this._getSessionFilePath(sessionId);
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                } catch {}
                this._persistSessionsIndex();
            }
        } else {
            clearedCount = this.sessionsIndex.size;
            this.sessionsIndex.clear();
            this.sessionEventsCache.clear();
            try {
                if (fs.existsSync(DEBUG_DIR)) {
                    const files = fs.readdirSync(DEBUG_DIR);
                    for (const f of files) {
                        try { fs.unlinkSync(path.join(DEBUG_DIR, f)); } catch {}
                    }
                }
            } catch {}
        }

        return { success: true, clearedCount };
    }
}

export const debugManager = new DebugManager();
