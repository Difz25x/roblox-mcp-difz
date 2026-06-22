/**
 * process-manager.ts
 *
 * Roblox process management — runs on Node side, not via executor queue.
 *
 * Provides:
 *   listRobloxProcesses()   — scan OS for RobloxPlayerBeta processes
 *   launchRoblox(path)      — spawn RobloxPlayerLauncher.exe
 *   openGame(placeId, opts) — open game via roblox-player protocol with full join URL
 *   performScreenshot(pid)  — capture screenshot of a Roblox process window (anticheat-safe)
 */
export {};
