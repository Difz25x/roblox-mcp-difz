/**
 * tool-definitions.ts
 *
 * Central registry of all tools exposed via MCP.
 * Each tool has:
 *   - name:         Unique identifier used in tools/call
 *   - description:  Prompt for the AI explaining what the tool does
 *   - inputSchema:  JSON Schema for validating arguments
 *
 * Every tool here MUST have a matching handler in the Luau client script
 * (public/mcp.luau) under the tools router table.
 */
export {};
