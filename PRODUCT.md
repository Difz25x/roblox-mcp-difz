# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are dual power-users: reverse engineers, security researchers, and software engineers automating Roblox clients, alongside developers supervising autonomous AI agents (Claude Code, Cursor, Windsurf) executing live game interactions across single or multiple Roblox Windows processes.

## Product Purpose

Roblox MCP Command Deck provides a unified, production-grade local web cockpit and telemetry interface for the `roblox-mcp-difz` Model Context Protocol server. It enables real-time observation of active Roblox instances, client worker connections, interactive execution of 80+ MCP tools, discovery router synchronization (port 58295), executor UNC compliance matrix auditing, and operational lifecycle control.

## Positioning

The only comprehensive, multi-session MCP bridge for Roblox that pairs high-performance WebSocket/HTTP dual-transport and automated background port discovery with an integrated developer cockpit for both autonomous AI agents and manual reverse-engineering workflows.

## Operating Context

Operators run the server locally on Windows 10/11 alongside Roblox Player or Roblox Studio, typically with third-party executors (Solara, Wave, Delta, etc.) or standalone test harnesses. They switch between terminal coding/AI agent interaction and the browser dashboard running at `http://127.0.0.1:<port>/`. Workflows involve quick-copying Lua loaders, inspecting live process IDs (PIDs) and memory usage, verifying UNC function support, monitoring agent throughput, and diagnosing or executing specific MCP tools in an interactive playground.

## Capabilities and Constraints

- **Five Core Views**:
  1. *Instances*: Active Roblox Windows processes, memory usage, connection state, window screenshots, and process termination.
  2. *Tools Explorer*: Interactive documentation and live test execution playground for 80+ MCP tools with typed parameters, category filtering, and JSON-RPC 2.0 payloads.
  3. *Custom Port & Sync*: Display and configuration of main server port, fixed discovery port (58295), port availability checker, and in-game loader snippets.
  4. *UNC Matrix*: Comprehensive audit grid of 38+ Universal Naming Convention executor functions with fallback status and executor detection.
  5. *Operations*: Transport mode toggling (`auto`, `ws`, `stream`), teleport auto-execution persistence, and graceful server shutdown.
- **Backend APIs**: Must preserve full compatibility with existing Express endpoints (`/health`, `/api/processes`, `/api/tools`, `/api/tools/execute`, `/api/config/port`, `/api/config/port-check`, `/api/config/port-save`, `/api/unc`, `/api/transport`, `/api/autoexecute`, `/stop`, `/mcp.lua`).
- **Zero Third-Party CDN Bloat**: Self-contained client architecture (vanilla HTML5, CSS3, ES6 JavaScript) served directly from the local Node.js server without external runtime dependencies or fragile CDNs.

## Brand Commitments

- Product name: **Roblox MCP** (`roblox-mcp-difz` / `rblx-mcp`).
- Tone: Tactical, precise, authoritative, highly functional developer tool.
- Architecture: Zero filler, no placeholder code, rock-solid stability.

## Evidence on Hand

- Incumbent implementation: `public/dashboard.html`, `public/dashboard.css`, `public/dashboard.js`.
- Lua client payload: `public/mcp.lua`.
- Core server architecture: `src/server-core.ts`, `src/discovery-server.ts`.
- Pruning roadmap and tool definitions: `docs/PRD-v1.7.0-tool-simplification.md`, `docs/SPEC-v1.7.0-tool-simplification.md`.

## Product Principles

1. **High Information Density with Visual Calm**: Dense, scan-friendly data layouts that respect the operator's focus; avoid visual clutter while keeping critical status visible at a glance.
2. **Instant Operational Feedback**: Every action (copy, execute, toggle, kill) provides immediate tactile, non-blocking feedback.
3. **Resilient Local-First Execution**: Graceful degradation when Roblox is closed, port conflicts arise, or network connections drop.
4. **Uncompromised Precision**: Exact representation of technical parameters, PIDs, memory values, and JSON payloads.
