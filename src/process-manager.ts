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

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const IS_WIN: boolean = process.platform === 'win32';
const ROBLOX_PROCESS: string = 'RobloxPlayerBeta';
const BROWSER_TRACKER_ID = (): string => `tracker_${Date.now()}`;

// ================================================================
// Process listing
// ================================================================

interface RobloxProcessInfo {
    pid: number;
    name: string;
    windowTitle: string;
    memoryMB: number;
}

function listRobloxProcesses(): RobloxProcessInfo[] {
    const results: RobloxProcessInfo[] = [];
    try {
        let output: string;
        if (IS_WIN) {
            output = execSync('tasklist /FO CSV /NH /V', { encoding: 'utf-8' as BufferEncoding, timeout: 5000 }) as string;
        } else {
            output = execSync("ps aux | grep -i roblox || true", { encoding: 'utf-8' as BufferEncoding, timeout: 5000 }) as string;
        }
        const lines: string[] = output.split('\n');
        for (const line of lines) {
            const trimmed: string = line.trim();
            if (!trimmed) continue;
            let pid: number, name: string, windowTitle: string, memStr: string;
            if (IS_WIN) {
                const parts: RegExpMatchArray | null = trimmed.match(/"([^"]*)"/g);
                if (!parts || parts.length < 5) continue;
                name = (parts[0] || '').replace(/"/g, '');
                pid = parseInt((parts[1] || '').replace(/"/g, ''), 10);
                memStr = (parts[4] || '').replace(/[^0-9,]/g, '').replace(',', '');
                windowTitle = parts.length > 8 ? parts[8].replace(/"/g, '') : '';
            } else {
                const parts: string[] = trimmed.split(/\s+/);
                if (parts.length < 11) continue;
                name = parts[10] || '';
                pid = parseInt(parts[1], 10);
                memStr = parts[5] || '0';
                windowTitle = parts.slice(10).join(' ');
            }
            const nameLower: string = name.toLowerCase();
            if (!nameLower.includes('roblox') && !windowTitle.toLowerCase().includes('roblox')) continue;
            if (nameLower.includes('launcher')) continue;
            results.push({
                pid,
                name: name || 'RobloxPlayerBeta',
                windowTitle,
                memoryMB: parseInt(memStr, 10) || 0,
            });
        }
    } catch (e: any) { console.error('[PM] listRobloxProcesses error:', e?.message || e); }
    return results;
}

// ================================================================
// Roblox install path detection
// ================================================================

function findRobloxPath(): string | null {
    // 1. Registry
    try {
        const regOutput: string = execSync(
            'reg query "HKLM\\SOFTWARE\\Roblox\\RobloxStudio" /v Location 2>nul || ' +
            'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Roblox\\RobloxStudio" /v Location 2>nul',
            { encoding: 'utf-8' as BufferEncoding, timeout: 3000 }
        ) as string;
        const match: RegExpMatchArray | null = regOutput.match(/Location\s+REG_SZ\s+(.+)/);
        if (match) {
            const launcher: string = path.join(match[1].trim(), 'RobloxPlayerLauncher.exe');
            if (fs.existsSync(launcher)) return launcher;
        }
    } catch (e: any) { console.error('[PM] registry error:', e?.message || e); }

    // 2. Common version directories
    const candidates: string[] = [
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Roblox', 'Versions') : '',
        'C:\\Program Files (x86)\\Roblox\\Versions',
        'C:\\Program Files\\Roblox\\Versions',
    ];
    for (const dir of candidates) {
        if (!dir || !fs.existsSync(dir)) continue;
        try {
            const versions: string[] = fs.readdirSync(dir).filter((v: string) => v.startsWith('version-')).sort().reverse();
            for (const ver of versions) {
                const launcher: string = path.join(dir, ver, 'RobloxPlayerLauncher.exe');
                if (fs.existsSync(launcher)) return launcher;
            }
        } catch (e: any) { console.error('[PM] readdir error:', e?.message || e); }
    }
    return null;
}

// ================================================================
// Launch Roblox
// ================================================================

interface LaunchResult {
    success: boolean;
    pid?: number;
    path?: string;
    error?: string;
}

function launchRoblox(customPath?: string): LaunchResult {
    const exePath: string | null = customPath || findRobloxPath();
    if (!exePath) {
        return { success: false, error: 'Roblox not found. Install Roblox or provide a custom path.' };
    }
    if (!fs.existsSync(exePath)) {
        return { success: false, error: `Roblox executable not found at: ${exePath}` };
    }
    try {
        const child = spawn(exePath, [], { detached: true, stdio: 'ignore', windowsHide: false });
        child.unref();
        return { success: true, pid: child.pid as number, path: exePath };
    } catch (err: any) {
        return { success: false, error: `Failed to launch Roblox: ${err.message}` };
    }
}

// ================================================================
// Open game via roblox-player protocol (full join URL format)
// ================================================================

interface OpenGameOptions {
    launchMode?: string;
    jobId?: string;
    privateServerLinkCode?: string;
    browserTrackerId?: string;
    launchTime?: string;
    authTicket?: string;
}

interface OpenGameResult {
    success: boolean;
    launchUrl?: string;
    error?: string;
}

function openGame(placeId: string, opts?: OpenGameOptions): OpenGameResult {
    opts = opts || {};
    const launchMode: string = opts.launchMode || 'play';
    const jobId: string = opts.jobId || '';
    const privateServerLinkCode: string = opts.privateServerLinkCode || '';
    const browserTrackerId: string = opts.browserTrackerId || `tracker_${Date.now()}`;
    const launchTime: string = opts.launchTime || Date.now().toString();
    const authTicket: string = opts.authTicket || '';

    if (!placeId) {
        return { success: false, error: 'placeId is required' };
    }

    let launchUrl: string;

    if (launchMode === 'play') {
        const cleanJobId: string = jobId.trim();
        const cleanPrivateServerLinkCode: string = privateServerLinkCode.trim();
        const gameInstanceId: string = cleanJobId && !cleanJobId.startsWith('http')
            ? `+gameInstanceId:${cleanJobId}`
            : '';

        if (cleanPrivateServerLinkCode) {
            const baseUrl: string = 'https://assetgame.roblox.com/game/PlaceLauncher.ashx';
            const rawUrl: string = `${baseUrl}?request=RequestPrivateGame&browserTrackerId=${browserTrackerId}&placeId=${placeId}&linkCode=${cleanPrivateServerLinkCode}`;
            const encodedUrl: string = encodeURIComponent(rawUrl);
            launchUrl = `roblox-player:1+launchmode:play+gameinfo:${authTicket ? encodeURIComponent(authTicket) : ''}+launchtime:${launchTime}+placelauncherurl:${encodedUrl}+browsertrackerid:${browserTrackerId}+robloxLocale:en_us+gameLocale:en_us+channel:`;
        } else if (cleanJobId && cleanJobId.startsWith('http')) {
            const encodedUrl: string = encodeURIComponent(cleanJobId);
            launchUrl = `roblox-player:1+launchmode:play+gameinfo:${authTicket ? encodeURIComponent(authTicket) : ''}+launchtime:${launchTime}+placelauncherurl:${encodedUrl}+browsertrackerid:${browserTrackerId}+robloxLocale:en_us+gameLocale:en_us+channel:`;
        } else {
            const joinUrl: string = `https%3A%2F%2Fassetgame.roblox.com%2Fgame%2FPlaceLauncher.ashx%3Frequest%3DRequestGame%26browserTrackerId%3D${browserTrackerId}%26placeId%3D${placeId}%26isPlayTogetherGame%3Dfalse${gameInstanceId.replace(/\+/g, '%2B')}`;
            launchUrl = `roblox-player:1+launchmode:play+gameinfo:${authTicket ? encodeURIComponent(authTicket) : ''}+launchtime:${launchTime}+placelauncherurl:${joinUrl}+browsertrackerid:${browserTrackerId}+robloxLocale:en_us+gameLocale:en_us+channel:`;
        }
    } else if (launchMode === 'edit') {
        launchUrl = `roblox-player:1+launchmode:edit+placeId:${placeId}`;
    } else {
        return { success: false, error: `Unknown launch mode: ${launchMode}` };
    }

    try {
        if (IS_WIN) {
            const start = spawn('cmd', ['/c', 'start', '', launchUrl], {
                detached: true, stdio: 'ignore', windowsHide: true,
            });
            start.unref();
        } else {
            const open = spawn('open', [launchUrl], {
                detached: true, stdio: 'ignore',
            });
            open.unref();
        }
        return { success: true, launchUrl };
    } catch (err: any) {
        return { success: false, error: `Failed to open game: ${err.message}` };
    }
}

// ================================================================
// Screenshot capture (Windows only) — PrintWindow-based
// ================================================================

interface RobloxWindowInfo {
    pid: number;
    hwnd: string;
    title: string;
}

interface ScreenshotResult {
    error?: string;
    needsDisambiguation?: boolean;
    windows?: RobloxWindowInfo[];
    imageBase64?: string;
}

function isSupported(): boolean {
    return process.platform === 'win32';
}

function enumRobloxWindows(): RobloxWindowInfo[] {
    const ps = `
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class WinEnum {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int maxCount);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    public static List<object[]> GetVisibleWindows() {
        var result = new List<object[]>();
        EnumWindows((hWnd, _) => {
            if (!IsWindowVisible(hWnd)) return true;
            var sb = new StringBuilder(256);
            GetWindowText(hWnd, sb, 256);
            string title = sb.ToString();
            if (string.IsNullOrEmpty(title)) return true;
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            result.Add(new object[] { pid, hWnd.ToString(), title });
            return true;
        }, IntPtr.Zero);
        return result;
    }
}
"@
$robloxPids = @(Get-Process -Name 'RobloxPlayerBeta' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
if ($robloxPids.Count -eq 0) { Write-Output '[]'; exit }
$allWindows = [WinEnum]::GetVisibleWindows()
$found = @()
foreach ($w in $allWindows) {
    if ($robloxPids -contains [int]$w[0]) {
        $found += [PSCustomObject]@{ pid=[int]$w[0]; hwnd=$w[1]; title=$w[2] }
    }
}
if ($found.Count -eq 0) { Write-Output '[]' } else { $found | ConvertTo-Json -Compress }
`;
    const tmpFile = path.join(os.tmpdir(), `roblox_enum_${Date.now()}.ps1`);
    try {
        fs.writeFileSync(tmpFile, ps, "utf-8");
        const raw = execSync(
            `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmpFile}"`,
            { encoding: "utf-8" as BufferEncoding, timeout: 15000, windowsHide: true }
        ).trim();
        if (!raw || raw === "null") return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch { return []; }
    finally { try { fs.unlinkSync(tmpFile); } catch {} }
}

function captureWindowPNG(hwnd: string): string {
    const outFile = path.join(os.tmpdir(), `roblox_ss_${Date.now()}.b64`);
    const escapedOut = outFile.replace(/\\/g, '\\\\');
    const ps = `
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinCapture {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hDC, uint nFlags);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$hwnd = [IntPtr]::new([long]${hwnd})
if ([WinCapture]::IsIconic($hwnd)) { [WinCapture]::ShowWindow($hwnd, 9) | Out-Null; Start-Sleep -Milliseconds 200 }
$rect = New-Object WinCapture+RECT
[WinCapture]::GetClientRect($hwnd, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left; $h = $rect.Bottom - $rect.Top
if ($w -le 0 -or $h -le 0) { Write-Error "Zero size"; exit 1 }
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $gfx.GetHdc()
[WinCapture]::PrintWindow($hwnd, $hdc, 2) | Out-Null
$gfx.ReleaseHdc($hdc); $gfx.Dispose()
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
$bytes = $ms.ToArray(); $ms.Dispose()
$b64 = [Convert]::ToBase64String($bytes)
[System.IO.File]::WriteAllText('${escapedOut}', $b64)
Write-Output 'OK'
`;
    const tmpFile = path.join(os.tmpdir(), `roblox_cap_${Date.now()}.ps1`);
    try {
        fs.writeFileSync(tmpFile, ps, "utf-8");
        execSync(
            `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmpFile}"`,
            { encoding: "utf-8" as BufferEncoding, timeout: 15000, windowsHide: true }
        );
        if (!fs.existsSync(outFile)) throw new Error("No output");
        const result = fs.readFileSync(outFile, "utf-8").trim();
        if (!result) throw new Error("Empty output");
        return result;
    } finally {
        try { fs.unlinkSync(tmpFile); } catch {}
        try { fs.unlinkSync(outFile); } catch {}
    }
}

function performScreenshot(pid?: number): ScreenshotResult {
    const windows = enumRobloxWindows();
    if (windows.length === 0) {
        return { error: "No visible Roblox windows found." };
    }
    let targets = windows;
    if (pid !== undefined) {
        targets = windows.filter((w) => w.pid === pid);
        if (targets.length === 0) {
            return { error: `No Roblox window for PID ${pid}. Available:\n` + windows.map((w) => `  PID ${w.pid} - "${w.title}"`).join("\n") };
        }
    }
    if (targets.length > 1 && pid === undefined) {
        return { needsDisambiguation: true, windows: targets };
    }
    const imageBase64 = captureWindowPNG(targets[0].hwnd);
    return { imageBase64 };
}

module.exports = {
    listRobloxProcesses,
    launchRoblox,
    openGame,
    findRobloxPath,
    isSupported,
    enumRobloxWindows,
    performScreenshot,
};
