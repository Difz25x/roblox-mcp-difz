---
name: Roblox MCP Command Deck
description: Datamatics Monochrome Sublime - High-density binary-contrast developer telemetry cockpit
colors:
  bg-void: "#000000"
  bg-subtle: "#050608"
  bg-surface: "#0a0c10"
  bg-surface-hover: "#12151c"
  bg-elevated: "#181b24"
  bg-active: "#ffffff"
  bg-active-hover: "#e6e6e6"
  text-active-contrast: "#262626"
  border-hairline: "#1c202a"
  border-mid: "#2d3342"
  border-bright: "#4a546d"
  border-active: "#ffffff"
  text-primary: "#ffffff"
  text-secondary: "#cbd5e1"
  text-muted: "#8b95a8"
  text-faint: "#555d6e"
  text-inverted: "#000000"
typography:
  metric:
    fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace'
    fontSize: "24px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  headline:
    fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace'
    fontSize: "20px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  subhead:
    fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace'
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "0.01em"
  title:
    fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace'
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.02em"
  body:
    fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  interface:
    fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace'
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace'
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.03em"
  micro:
    fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace'
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.04em"
rounded:
  none: "0px"
  sm: "2px"
  md: "4px"
components:
  button-primary:
    backgroundColor: "{colors.bg-active}"
    textColor: "{colors.text-inverted}"
    rounded: "{rounded.none}"
    padding: "0 0.95rem"
    height: "32px"
  button-secondary:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.none}"
    padding: "0 0.95rem"
    height: "32px"
  tab-active:
    backgroundColor: "{colors.bg-active}"
    textColor: "{colors.text-inverted}"
    rounded: "{rounded.none}"
    padding: "0 0.85rem"
    height: "32px"
---

# Design System: Datamatics Monochrome Sublime

## Overview

The Roblox MCP Command Deck design system is built on **Datamatics Monochrome Sublime**: an ultra-dense, binary-contrast telemetry cockpit inspired by precision hardware logic analyzers, Ryoji Ikeda data graphics, and low-level machine registers. It rejects generic SaaS gradients, bloated card grids, and cookie-cutter dashboards in favor of raw informational clarity, tabular numerals, razor-sharp 1px hairlines, and instant high-contrast binary state transitions.

## Colors

The palette is strictly calibrated for zero distraction and high focus:

- **Void Black (`#000000`)**: Base viewport ground and embedded terminal canvas.
- **Deep Subtle (`#050608`)**: Container card panels and datagrid backdrop.
- **Surface (`#0a0c10`)**: Header bars, table headers, and inactive button surfaces.
- **Surface Hover (`#12151c`)**: Subtle tactile hover feedback state.
- **Signal White (`#ffffff`)**: Primary text, active navigation tabs, inverted buttons, and focused borders.
- **Silver Secondary (`#cbd5e1`)**: Readable body and parameter descriptions.
- **Muted Slate (`#8b95a8`)**: Metadata labels, units, and secondary indicators.
- **Faint Border Hairlines (`#1c202a`, `#2d3342`)**: Structural grid lines and panel dividers.

## Typography

A unified monospace typography stack (`ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace`) ensures exact character alignment for memory offsets, PIDs, JSON payloads, and execution latencies:

- **Tabular Numerals**: Every numeric value uses `font-feature-settings: "tnum" 1, "zero" 1` and `font-variant-numeric: tabular-nums` to eliminate jitter during continuous polling.
- **Display Scale**:
  - Metric Values: 24px, 800 weight, -0.02em tracking.
  - Section Headlines: 20px / 15px, 700 weight, uppercase, 0.02em tracking.
  - Body Descriptions: 13px, 400 weight, 1.6 line height.
  - Interface Text: 12px, 500 weight, 1.5 line height.
  - Labels & Badges: 11px, 700 weight, uppercase, 0.03em tracking.
  - Micro Metadata: 10px, 600 weight, 1.2 line height.

## Layout

- **Flush Top Deck**: Fixed 52px control bar with brand mark, view switcher tabs, autoexec toggle, and quick copy triggers.
- **4-Column Telemetry Ribbon**: Fixed-aspect metrics grid displaying Roblox process count, worker sessions, registered tools, and total throughput.
- **Split-Pane Tools Workspace**: 380px fixed sticky directory sidebar on the left paired with a comprehensive parameter and execution canvas on the right.
- **Responsive Adaptations**: Fluid collapse from multi-column desktop grids into stacked single-column layouts below 1080px and 640px breakpoints.

## Elevation & Depth

- **Zero Soft Shadows**: Eliminates diffuse box shadows (`box-shadow: none`) in favor of definite, laser-sharp 1px border edges.
- **High-Contrast Modal Overlay**: Full-screen `#000000` backdrop (88% opacity) with a solid `#ffffff` 1px border container.
- **Binary Inversion Depth**: Active or selected elements elevate through total polarity inversion (white surface `#ffffff` with black ink `#000000`).

## Shapes

- **Geometric Hard Edges**: Zero rounded corners (`border-radius: 0px`) or micro-subtle radii (`2px`) across buttons, cards, tables, and dialogs.
- **Hairline Dividers**: 1px solid boundaries separating all table cells and panel headers.

## Components

- **Navigation Tabs**: Pill-less, flush rectangular buttons with keyboard shortcut badges (`[1]`, `[2]`, `[3]`, `[4]`, `[5]`).
- **Telemetry Cells**: Monospaced statistic blocks with micro-tag metadata headers.
- **Interactive Datagrid**: Flush tabular rows with quick action buttons (`[SCREENSHOT]`, `[KILL]`) and live status badges.
- **In-Page Screenshot Stage**: Integrated canvas frame that displays captured window buffers directly without external popups.
- **Execution Terminal**: High-contrast command console with execution timing (ms) and formatted JSON-RPC 2.0 output.
- **Tactile Toast**: High-contrast bottom-right notification pill (`#ffffff` fill, `#000000` text) with instant tactile snap.

## Do's and Don'ts

### Do's
- Always format numbers and latencies with tabular monospace styling.
- Keep border dividing lines strictly at 1px thickness.
- Use full white-on-black binary inversion for active states and primary triggers.
- Provide instant tactile feedback (toast and console status) for every action.
- Preserve keyboard navigation shortcuts (`/`, `1-5`, `L`, `R`, `Esc`).

### Don'ts
- Never use rainbow gradients, colored borders, or decorative text shadows.
- Never use font sizes below 11px for any functional UI text or labels.
- Never use empty `<img>` tags or broken image placeholders.
- Never add diffuse, cloudy drop-shadows on dark surfaces.
- Never use nested cards or multi-layer containers.
