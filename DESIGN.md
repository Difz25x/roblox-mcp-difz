---
name: Roblox MCP Command Deck
description: Tactile Monochrome Cockpit - Natural curves, physical 3D elevation, and high-density telemetry
colors:
  bg-void: "#030406"
  bg-subtle: "#090b10"
  bg-surface: "#0f1218"
  bg-surface-hover: "#161b24"
  bg-elevated: "#1d222e"
  bg-active: "#ffffff"
  bg-active-hover: "#e6e6e6"
  text-active-contrast: "#262626"
  border-hairline: "#1c212c"
  border-mid: "#2b3344"
  border-bright: "#44506b"
  border-active: "#ffffff"
  text-primary: "#ffffff"
  text-secondary: "#cbd5e1"
  text-muted: "#94a3b8"
  text-faint: "#94a3b8"
  text-inverted: "#000000"
typography:
  metric:
    fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace'
    fontSize: "26px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  headline:
    fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace'
    fontSize: "21px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  subhead:
    fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace'
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "0.02em"
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
  sm: "5px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  pill: "9999px"
components:
  button-primary:
    backgroundColor: "{colors.bg-active}"
    textColor: "{colors.text-inverted}"
    rounded: "{rounded.md}"
    padding: "0 0.95rem"
    height: "32px"
  button-secondary:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "0 0.95rem"
    height: "32px"
  tab-active:
    backgroundColor: "{colors.bg-active}"
    textColor: "{colors.text-inverted}"
    rounded: "{rounded.pill}"
    padding: "0 0.95rem"
    height: "32px"
---

# Design System: Tactile Monochrome Cockpit

## Overview

The Roblox MCP Command Deck design system combines the informational rigor of **Datamatics Monochrome** with natural rounded geometries, tactile depth, subtle 3D rim lighting, and physical elevation. It eliminates rigid 90-degree square boxes in favor of smooth, ergonomic corner contours (`5px`, `8px`, `12px`, `16px`, and full pill capsules) paired with multi-layer ambient occlusion shadows and tactile inset console screens.

## Colors

The palette preserves high-contrast monochrome clarity while introducing subtle surface gradients for 3D realism:

- **Void Black (`#030406`)**: Ambient backdrop with subtle radial light vignette.
- **Subtle Surface (`#090b10` to `#07090c`)**: Beveled container cards and panel backdrops.
- **Surface Layer (`#0f1218`)**: Interactive bars, table headers, and tactile button chassis.
- **Surface Hover (`#161b24`)**: Elevated interactive hover state.
- **Signal White (`#ffffff`)**: Primary labels, active navigation capsules, and illuminated rim lights.
- **Secondary Slate (`#cbd5e1`)**: High-legibility body descriptions and technical arguments.
- **Muted Steel (`#8c97ad`)**: Metadata units, timecodes, and secondary tags.
- **Beveled Borders (`#1c212c`, `#2b3344`, `#44506b`)**: Physical structural seams and highlighted edges.

## Typography

Unified monospace typography stack (`ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace`) with strict tabular numeral alignment:

- **Tabular Numerals**: Numeric metrics and counters use `font-variant-numeric: tabular-nums` to eliminate layout shift during live background polling.
- **Display Scale**:
  - Metric Telemetry: 26px, 800 weight, -0.02em tracking.
  - Section Headlines: 21px / 16px, 700 weight, 0.02em tracking.
  - Body Descriptions: 13px, 400 weight, 1.6 line height.
  - Interface Text: 12px, 500 weight, 1.55 line height.
  - Labels & Badges: 11px, 700 weight, uppercase, 0.03em tracking.

## Layout

- **Floating Command Island**: Floating 54px navigation island with `16px` rounded corners, glassmorphic backdrop blur (16px), subtle inner rim light, and deep ambient shadow.
- **Tactile Bento Telemetry Grid**: 4-column modular metric cards with individual `12px` rounded corners and subtle top-edge specular highlights.
- **Split-Pane Tools Workspace**: 390px sticky directory sidebar with rounded search inputs and pill-shaped category chips paired with a rounded execution canvas.
- **Responsive Adaptations**: Smooth fluid stacking for displays under 1080px and 640px.

## Elevation & Depth

- **Tactile 3D Keypresses**: Buttons feature vertical linear gradients, subtle top rim highlights (`inset 0 1px 0 rgba(255, 255, 255, 0.12)`), and tangible depression on active press (`transform: translateY(1px)`).
- **Recessed Sunken Screens**: Text inputs and live output terminal use inward shadow depth (`inset 0 2px 4px rgba(0, 0, 0, 0.65)`) to simulate sunken physical CRT/LCD panels.
- **Multi-Layer Card Elevation**: Panels float with realistic dual-layer shadows (`0 6px 16px rgba(0, 0, 0, 0.5)` combined with top specular bevels).
- **Elevated Modal Dialogs**: Floating dialog chassis with `16px` radius, deep backdrop blur, and 28px ambient occlusion shadow.

## Shapes

- **Natural Rounded Contours**:
  - Small elements (quick chips, inner items): `5px` (`--radius-sm`).
  - Controls, buttons, inputs, table rows: `8px` (`--radius-md`).
  - Cards, panels, datagrid containers: `12px` (`--radius-lg`).
  - Floating top island, modals: `16px` (`--radius-xl`).
  - Badges, status chips, tab buttons: `9999px` (`--radius-pill`).
- **Inner Rim Lighting**: 1px subtle top highlights (`rgba(255, 255, 255, 0.07)`) create tactile 3D physical boundaries.

## Components

- **Capsule Navigation Rail**: Inset dark pill rail holding smooth pill buttons with keyboard shortcut badges.
- **Tactile Telemetry Cards**: Elevated bento boxes with hover lift and micro-tag badges.
- **Rounded Datagrid**: Table container with smooth outer corners, alternating hover rows, and pill status tags.
- **In-Page Screenshot Frame**: Recessed black canvas stage with rounded corners.
- **Physical Execution Terminal**: Sunken dark terminal with top control bar and tactile buttons.
- **Floating 3D Toast**: Pill/rounded notification card with white gloss finish and drop shadow.

## Do's and Don'ts

### Do's
- Use consistent rounded corner tokens (`--radius-sm` through `--radius-pill`).
- Pair outer drop shadows with subtle top-edge inner specular highlights for authentic 3D depth.
- Give buttons physical tactile states (hover elevation and active press transform).
- Recess input fields and code terminals with subtle inset shadows.
- Keep numbers tabular and typography crisp.

### Don'ts
- Never use completely sharp 0px corners across containers and buttons.
- Never use flat 1-color rectangles without depth or tactile elevation.
- Never use blurry, diffuse zero-offset colored halos.
- Never use text smaller than 11px for any functional element.
- Never compromise performance with expensive heavy filters.
