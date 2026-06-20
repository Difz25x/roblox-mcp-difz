/**
 * process-manager.ts
 *
 * Roblox process management — runs on Node side, not via executor queue.
 *
 * Provides:
 *   listRobloxProcesses()   — scan OS for RobloxPlayerBeta processes
 *   launchRoblox(path)      — spawn RobloxPlayerLauncher.exe
 *   openGame(placeId, opts) — open game via roblox-player protocol with full join URL
 *   captureRobloxWindow(pid) — capture screenshot of a Roblox process window
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const IS_WIN: boolean = os.platform() === 'win32';
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
    } catch (e: any) {
        console.error('[ProcessManager] listRobloxProcesses error:', e?.message || e);
    }
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
    } catch (e: any) {
        console.error('[ProcessManager] findRobloxPath registry error:', e?.message || e);
    }

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
        } catch (e: any) {
            console.error('[ProcessManager] findRobloxPath readdir error:', e?.message || e);
        }
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
            // Use spawn to avoid shell injection — launchUrl is one argv element
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
// Screenshot capture (Windows only)
// ================================================================

interface CaptureResult {
    success: boolean;
    pid?: number;
    image?: string;
    sizeBytes?: number;
    error?: string;
}

function captureRobloxWindow(pid?: number): CaptureResult {
    if (!IS_WIN) {
        return { success: false, error: 'Screenshot capture is only supported on Windows' };
    }

    try {
        const targetPid: number | undefined = pid || (listRobloxProcesses()[0] || {}).pid;
        if (!targetPid) {
            return { success: false, error: 'No Roblox process found to capture' };
        }

        const outputPath: string = path.join(os.tmpdir(), `roblox_ss_${Date.now()}.png`);

        // PowerShell script to capture a specific window by PID using .NET
        const psScript: string = `
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Drawing;
public class Capture {
    [DllImport("user32.dll")]
    public static extern IntPtr GetWindowThreadProcessId(IntPtr hWnd, out int pid);
    [DllImport("user32.dll")]
    public static extern IntPtr FindWindow(string c, string t);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")]
    public static extern IntPtr WindowFromPoint(long point);
    [DllImport("user32.dll")]
    public static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")]
    public static extern IntPtr GetWindowDC(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, int nFlags);
    [DllImport("gdi32.dll")]
    public static extern bool DeleteDC(IntPtr hdc);
    [DllImport("gdi32.dll")]
    public static extern bool DeleteObject(IntPtr hObject);
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    public static Bitmap CaptureWindow(IntPtr hWnd) {
        RECT r; GetWindowRect(hWnd, out r);
        int w = r.Right - r.Left; int h = r.Bottom - r.Top;
        if (w <= 0 || h <= 0) return null;
        Bitmap bmp = new Bitmap(w, h);
        Graphics gfx = Graphics.FromImage(bmp);
        IntPtr hdc = gfx.GetHdc();
        PrintWindow(hWnd, hdc, 0);
        gfx.ReleaseHdc(hdc);
        gfx.Dispose();
        return bmp;
    }
}
"@
$targetPid = ${targetPid}
$procs = [System.Diagnostics.Process]::GetProcesses()
foreach ($p in $procs) {
    if ($p.Id -eq $targetPid -and $p.MainWindowHandle -ne [IntPtr]::Zero) {
        $bmp = [Capture]::CaptureWindow($p.MainWindowHandle)
        if ($bmp) {
            $bmp.Save("${outputPath}", [System.Drawing.Imaging.ImageFormat]::Png)
            $bmp.Dispose()
            Write-Output "CAPTURED:${outputPath}"
        } else {
            Write-Output "ERROR:Window capture returned null"
        }
        exit
    }
}
Write-Output "ERROR:Process with window not found"
`;

        // Write PS script to temp file to avoid shell escaping issues
        const psFile: string = path.join(os.tmpdir(), `roblox_capture_${Date.now()}.ps1`);
        fs.writeFileSync(psFile, psScript, 'utf-8');

        const result: string = execSync(
            `powershell -NoProfile -NonInteractive -File "${psFile}"`,
            { encoding: 'utf-8' as BufferEncoding, timeout: 10000 }
        ) as string;

        // Clean up temp script
        try { fs.unlinkSync(psFile); } catch (e: any) { console.error('[ProcessManager] cleanup error:', e?.message || e); }

        const trimmed: string = result.trim();
        if (trimmed.startsWith('CAPTURED:')) {
            const filePath: string = trimmed.substring(9);
            if (fs.existsSync(filePath)) {
                const base64: string = fs.readFileSync(filePath, { encoding: 'base64' as BufferEncoding });
                const sizeBytes: number = base64.length;
                fs.unlinkSync(filePath);
                return {
                    success: true,
                    pid: targetPid,
                    image: `data:image/png;base64,${base64}`,
                    sizeBytes,
                };
            }
            return { success: false, error: 'Screenshot file was not created' };
        }

        return { success: false, error: trimmed || 'Unknown capture error' };

    } catch (err: any) {
        return { success: false, error: `Screenshot failed: ${err.message}` };
    }
}

module.exports = {
    listRobloxProcesses,
    launchRoblox,
    openGame,
    findRobloxPath,
    captureRobloxWindow,
};
