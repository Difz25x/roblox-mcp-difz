---
version: 1
slug: "public-dashboard-html"
primary_target: "public/dashboard.html"
related_targets: ["public/dashboard.css","public/dashboard.js"]
---

# Surface Brief: Roblox MCP Command Deck

## Scope and Visitor Mode
- Target: `public/dashboard.html`, `public/dashboard.css`, `public/dashboard.js`
- Visitor Mode: **Operate**
- User: Dual power-user (reverse engineers & AI agent supervisors)

## Direction contract

### THESIS
The Roblox MCP Command Deck rejects generic SaaS gradients, bloated card grids, and cookie-cutter dashboards in favor of the **Datamatics Monochrome Sublime** world: a relentlessly crisp, high-density, binary-contrast telemetry cockpit where data rules, hairline dividers, tabular numbers, and monospace precision govern every pixel.

### OWN-WORLD
- Palette: Pure void black (`#000000`), deep chassis (`#080808`), slate register (`#111111`), boundary hairline (`#222222`, `#333333`), muted metadata (`#777777`, `#999999`), and stark signal white (`#ffffff`). Accent states invert into full-bleed white `#ffffff` with black ink `#000000`.
- Materials: Laser-sharp 1px hairlines, tabular data registers, micro-barcode telemetry patterns, crisp SVG geometric icons (2px stroke, 0 fill), instant tactile state shifts without mushy animations.
- Typography: Precision monospace system (`ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace`) paired with an ultra-clean, tightly tracked geometric sans header. Strict `tabular-nums` for all metrics, latencies, PIDs, and counters.

### STORY
The operator lands on an instant, live diagnostic readout of their Roblox automation environment. At a single glance across the top telemetry register, they verify process presence, worker handshake, tool readiness, and throughput. They can switch between instances, drill into any of 80 tools with live schema and playground execution, monitor and verify custom port discovery, audit UNC functions, or control server lifecycle with zero latency and zero friction.

### FIRST VIEWPORT
Top flush diagnostic bar with server status, uptime counter, and transport indicators. Directly below, a dense 4-column telemetry register with hairline borders. The main viewport hosts the active modular panel: a dual-pane instance & process manager with live PID badges and screenshot viewer, or the comprehensive split-pane Tool Directory with fast `/` search, category filter pills, interactive parameter inputs, and real-time JSON-RPC response terminal.

### FORM
Ryoji Ikeda Datamatics / Data Sublime (Challenger Dealt, Seed key: 93da5259).

### FINISH
unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
