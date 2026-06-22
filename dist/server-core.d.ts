/**
 * server-core.ts
 *
 * Roblox MCP Server — core module.
 *
 * Standard MCP HTTP endpoints:
 *   POST /              MCP JSON-RPC 2.0
 *   POST /mcp           MCP JSON-RPC 2.0 (alias)
 *   GET  /health        Health check
 *
 * WebSocket:
 *   ws://host:port/ws   Executor transport (register/task/result) — WS ONLY
 *
 * Static:
 *   GET /mcp.lua        Executor client script
 */
export {};
