import * as fs from 'fs';
import * as path from 'path';

export interface McpSdkCapabilities {
    server: boolean;
    stdioTransport: boolean;
    types: boolean;
    tools: boolean;
    resources: boolean;
    prompts: boolean;
}

export interface McpSdkDiagnostics {
    available: boolean;
    version: string;
    packagePath: string | null;
    resolvedStrategy: 'standard-exports' | 'require-resolve' | 'local-search' | 'walk-search' | 'not-found';
    latestProtocolVersion: string;
    supportedProtocolVersions: string[];
    capabilities: McpSdkCapabilities;
    availableSchemas: string[];
    warnings: string[];
    scanDurationMs: number;
}

export interface LoadedMcpSdk {
    Server: any;
    StdioServerTransport: any;
    ListToolsRequestSchema: any;
    CallToolRequestSchema: any;
    ListResourcesRequestSchema: any;
    ReadResourceRequestSchema: any;
    ListPromptsRequestSchema: any;
    GetPromptRequestSchema: any;
    SubscribeRequestSchema?: any;
    UnsubscribeRequestSchema?: any;
    types: any;
    diagnostics: McpSdkDiagnostics;
}

let _cachedDiagnostics: McpSdkDiagnostics | null = null;
let _cachedSdk: LoadedMcpSdk | null = null;

function resolveSdkLocation(): { packagePath: string | null; strategy: McpSdkDiagnostics['resolvedStrategy'] } {
    try {
        const resolved = require.resolve('@modelcontextprotocol/sdk/server/index.js');
        if (resolved && fs.existsSync(resolved)) {
            let cur = path.dirname(resolved);
            while (cur && cur !== path.dirname(cur)) {
                if (fs.existsSync(path.join(cur, 'package.json'))) {
                    const p = JSON.parse(fs.readFileSync(path.join(cur, 'package.json'), 'utf8'));
                    if (p.name === '@modelcontextprotocol/sdk') {
                        return { packagePath: cur, strategy: 'standard-exports' };
                    }
                }
                cur = path.dirname(cur);
            }
            return { packagePath: path.dirname(path.dirname(resolved)), strategy: 'standard-exports' };
        }
    } catch {}

    try {
        const pkgJson = require.resolve('@modelcontextprotocol/sdk/package.json');
        if (pkgJson && fs.existsSync(pkgJson)) {
            const dir = path.dirname(pkgJson);
            const rootCandidate = path.resolve(dir, '..', '..');
            if (fs.existsSync(path.join(rootCandidate, 'package.json'))) {
                return { packagePath: rootCandidate, strategy: 'require-resolve' };
            }
            return { packagePath: dir, strategy: 'require-resolve' };
        }
    } catch {}

    const localCandidates = [
        path.resolve(__dirname, '..', 'node_modules', '@modelcontextprotocol', 'sdk'),
        path.resolve(__dirname, 'node_modules', '@modelcontextprotocol', 'sdk'),
        path.resolve(process.cwd(), 'node_modules', '@modelcontextprotocol', 'sdk'),
    ];
    for (const cand of localCandidates) {
        if (fs.existsSync(cand) && fs.existsSync(path.join(cand, 'package.json'))) {
            return { packagePath: cand, strategy: 'local-search' };
        }
    }

    let currentDir = __dirname;
    for (let i = 0; i < 6; i++) {
        const checkPath = path.join(currentDir, 'node_modules', '@modelcontextprotocol', 'sdk');
        if (fs.existsSync(checkPath) && fs.existsSync(path.join(checkPath, 'package.json'))) {
            return { packagePath: checkPath, strategy: 'walk-search' };
        }
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) break;
        currentDir = parentDir;
    }

    return { packagePath: null, strategy: 'not-found' };
}

export function scanMcpSdk(forceRefresh: boolean = false): McpSdkDiagnostics {
    if (_cachedDiagnostics && !forceRefresh) {
        return _cachedDiagnostics;
    }

    const startTime = performance.now();
    const warnings: string[] = [];
    const { packagePath, strategy } = resolveSdkLocation();

    let version = 'unknown';
    if (packagePath) {
        try {
            const pkgData = JSON.parse(fs.readFileSync(path.join(packagePath, 'package.json'), 'utf8'));
            version = pkgData.version || 'unknown';
        } catch {
            warnings.push('Failed to read SDK package.json metadata.');
        }
    } else {
        warnings.push('@modelcontextprotocol/sdk was not found.');
    }

    let serverFound = false;
    let stdioFound = false;
    let typesFound = false;
    let typesObj: any = null;

    try {
        const s = require('@modelcontextprotocol/sdk/server/index.js');
        serverFound = typeof s.Server === 'function';
    } catch {
        try {
            if (packagePath) {
                const s = require(path.join(packagePath, 'dist', 'cjs', 'server', 'index.js'));
                serverFound = typeof s.Server === 'function';
            }
        } catch (e: any) {
            warnings.push(`Server export error: ${e.message}`);
        }
    }

    try {
        const st = require('@modelcontextprotocol/sdk/server/stdio.js');
        stdioFound = typeof st.StdioServerTransport === 'function';
    } catch {
        try {
            if (packagePath) {
                const st = require(path.join(packagePath, 'dist', 'cjs', 'server', 'stdio.js'));
                stdioFound = typeof st.StdioServerTransport === 'function';
            }
        } catch (e: any) {
            warnings.push(`Stdio transport export error: ${e.message}`);
        }
    }

    try {
        typesObj = require('@modelcontextprotocol/sdk/types.js');
        typesFound = typesObj && typeof typesObj === 'object';
    } catch {
        try {
            if (packagePath) {
                typesObj = require(path.join(packagePath, 'dist', 'cjs', 'types.js'));
                typesFound = typesObj && typeof typesObj === 'object';
            }
        } catch (e: any) {
            warnings.push(`Types/Schemas export error: ${e.message}`);
        }
    }

    const availableSchemas: string[] = [];
    let latestProtocolVersion = 'unknown';
    let supportedProtocolVersions: string[] = [];

    if (typesObj) {
        for (const k of Object.keys(typesObj)) {
            if (k.endsWith('RequestSchema') || k.endsWith('NotificationSchema')) {
                availableSchemas.push(k);
            }
        }
        latestProtocolVersion = typesObj.LATEST_PROTOCOL_VERSION || 'unknown';
        supportedProtocolVersions = Array.isArray(typesObj.SUPPORTED_PROTOCOL_VERSIONS)
            ? typesObj.SUPPORTED_PROTOCOL_VERSIONS
            : [];
    }

    const capabilities: McpSdkCapabilities = {
        server: serverFound,
        stdioTransport: stdioFound,
        types: typesFound,
        tools: availableSchemas.includes('ListToolsRequestSchema') && availableSchemas.includes('CallToolRequestSchema'),
        resources: availableSchemas.includes('ListResourcesRequestSchema') && availableSchemas.includes('ReadResourceRequestSchema'),
        prompts: availableSchemas.includes('ListPromptsRequestSchema') && availableSchemas.includes('GetPromptRequestSchema'),
    };

    const isAvailable = serverFound && stdioFound && typesFound && capabilities.tools;
    const elapsed = Math.round((performance.now() - startTime) * 100) / 100;

    _cachedDiagnostics = {
        available: isAvailable,
        version,
        packagePath,
        resolvedStrategy: strategy,
        latestProtocolVersion,
        supportedProtocolVersions,
        capabilities,
        availableSchemas,
        warnings,
        scanDurationMs: elapsed,
    };

    return _cachedDiagnostics;
}

export function getMcpSdk(forceReload: boolean = false): LoadedMcpSdk {
    if (_cachedSdk && !forceReload) {
        return _cachedSdk;
    }

    const diag = scanMcpSdk(forceReload);
    if (!diag.available) {
        const errorMsg = [
            '------------------------------------------------------------------',
            'Error: @modelcontextprotocol/sdk could not be found.',
            '------------------------------------------------------------------',
            `Location: ${diag.packagePath || 'None found'}`,
            `Resolution: ${diag.resolvedStrategy}`,
            `Warnings: ${diag.warnings.join(' | ')}`,
            '',
            'To fix:',
            '  1. Run: npm install @modelcontextprotocol/sdk',
            '  2. Or install globally: npm install -g roblox-mcp-difz',
            '------------------------------------------------------------------',
        ].join('\n');
        throw new Error(errorMsg);
    }

    let Server: any;
    let StdioServerTransport: any;
    let types: any;

    try {
        Server = require('@modelcontextprotocol/sdk/server/index.js').Server;
        StdioServerTransport = require('@modelcontextprotocol/sdk/server/stdio.js').StdioServerTransport;
        types = require('@modelcontextprotocol/sdk/types.js');
    } catch {
        if (diag.packagePath) {
            Server = require(path.join(diag.packagePath, 'dist', 'cjs', 'server', 'index.js')).Server;
            StdioServerTransport = require(path.join(diag.packagePath, 'dist', 'cjs', 'server', 'stdio.js')).StdioServerTransport;
            types = require(path.join(diag.packagePath, 'dist', 'cjs', 'types.js'));
        }
    }

    _cachedSdk = {
        Server,
        StdioServerTransport,
        ListToolsRequestSchema: types.ListToolsRequestSchema,
        CallToolRequestSchema: types.CallToolRequestSchema,
        ListResourcesRequestSchema: types.ListResourcesRequestSchema,
        ReadResourceRequestSchema: types.ReadResourceRequestSchema,
        ListPromptsRequestSchema: types.ListPromptsRequestSchema,
        GetPromptRequestSchema: types.GetPromptRequestSchema,
        SubscribeRequestSchema: types.SubscribeRequestSchema,
        UnsubscribeRequestSchema: types.UnsubscribeRequestSchema,
        types,
        diagnostics: diag,
    };

    return _cachedSdk;
}

export function formatSdkReport(diag: McpSdkDiagnostics): string {
    const lines = [
        '------------------------------------------------------------------',
        'MCP SDK Diagnostics',
        '------------------------------------------------------------------',
        `Status:            ${diag.available ? 'Ready' : 'Not ready'}`,
        `SDK Version:       ${diag.version}`,
        `Resolved Via:      ${diag.resolvedStrategy}`,
        `Package Path:      ${diag.packagePath || 'Not found'}`,
        `Latest Protocol:   ${diag.latestProtocolVersion}`,
        `Supported Prots:   ${diag.supportedProtocolVersions.slice(0, 3).join(', ')}`,
        `Scan Time:         ${diag.scanDurationMs}ms`,
        '------------------------------------------------------------------',
        `Capabilities:`,
        `  Server Engine:     ${diag.capabilities.server ? 'Yes' : 'No'}`,
        `  Stdio Transport:   ${diag.capabilities.stdioTransport ? 'Yes' : 'No'}`,
        `  Tool Handlers:     ${diag.capabilities.tools ? 'Yes' : 'No'}`,
        `  Resource Provider: ${diag.capabilities.resources ? 'Yes' : 'No'}`,
        `  Prompt Templates:  ${diag.capabilities.prompts ? 'Yes' : 'No'}`,
        `Total Schemas:     ${diag.availableSchemas.length} loaded`,
        '------------------------------------------------------------------',
    ];
    if (diag.warnings.length > 0) {
        lines.push('Warnings:');
        diag.warnings.forEach(w => lines.push(`  - ${w}`));
    }
    return lines.join('\n');
}

module.exports = {
    scanMcpSdk,
    getMcpSdk,
    formatSdkReport,
};
