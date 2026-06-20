/**
 * process-manager.js
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

const IS_WIN = os.platform() === 'win32';
const ROBLOX_PROCESS = 'RobloxPlayerBeta';
const BROWSER_TRACKER_ID = () => `tracker_${Date.now()}`;

// ================================================================
// Process listing
// ================================================================

function listRobloxProcesses() {
    const results = [];
    try {
        let output;
        if (IS_WIN) {
            output = execSync('tasklist /FO CSV /NH /V', { encoding: 'utf-8', timeout: 5000 });
        } else {
            output = execSync("ps aux | grep -i roblox || true", { encoding: 'utf-8', timeout: 5000 });
        }
        const lines = output.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let pid, name, windowTitle, memStr;
            if (IS_WIN) {
                const parts = trimmed.match(/"([^"]*)"/g);
                if (!parts || parts.length < 5) continue;
                name = (parts[0] || '').replace(/"/g, '');
                pid = parseInt((parts[1] || '').replace(/"/g, ''), 10);
                memStr = (parts[4] || '').replace(/[^0-9,]/g, '').replace(',', '');
                windowTitle = parts.length > 8 ? parts[8].replace(/"/g, '') : '';
            } else {
                const parts = trimmed.split(/\s+/);
                if (parts.length < 11) continue;
                name = parts[10] || '';
                pid = parseInt(parts[1], 10);
                memStr = parts[5] || '0';
                windowTitle = parts.slice(10).join(' ');
            }
            const nameLower = name.toLowerCase();
            if (!nameLower.includes('roblox') && !windowTitle.toLowerCase().includes('roblox')) continue;
            if (nameLower.includes('launcher')) continue;
            results.push({
                pid,
                name: name || 'RobloxPlayerBeta',
                windowTitle,
                memoryMB: parseInt(memStr, 10) || 0,
            });
        }
    } catch {}
    return results;
}

// ================================================================
// Roblox install path detection
// ================================================================

function findRobloxPath() {
    // 1. Registry
    try {
        const regOutput = execSync(
            'reg query "HKLM\\SOFTWARE\\Roblox\\RobloxStudio" /v Location 2>nul || ' +
            'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Roblox\\RobloxStudio" /v Location 2>nul',
            { encoding: 'utf-8', timeout: 3000 }
        );
        const match = regOutput.match(/Location\s+REG_SZ\s+(.+)/);
        if (match) {
            const launcher = path.join(match[1].trim(), 'RobloxPlayerLauncher.exe');
            if (fs.existsSync(launcher)) return launcher;
        }
    } catch {}

    // 2. Common version directories
    const candidates = [
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Roblox', 'Versions') : '',
        'C:\\Program Files (x86)\\Roblox\\Versions',
        'C:\\Program Files\\Roblox\\Versions',
    ];
    for (const dir of candidates) {
        if (!dir || !fs.existsSync(dir)) continue;
        try {
            const versions = fs.readdirSync(dir).filter(v => v.startsWith('version-')).sort().reverse();
            for (const ver of versions) {
                const launcher = path.join(dir, ver, 'RobloxPlayerLauncher.exe');
                if (fs.existsSync(launcher)) return launcher;
            }
        } catch {}
    }
    return null;
}

// ================================================================
// Launch Roblox
// ================================================================

function launchRoblox(customPath) {
    const exePath = customPath || findRobloxPath();
    if (!exePath) {
        return { success: false, error: 'Roblox not found. Install Roblox or provide a custom path.' };
    }
    if (!fs.existsSync(exePath)) {
        return { success: false, error: `Roblox executable not found at: ${exePath}` };
    }
    try {
        const child = spawn(exePath, [], { detached: true, stdio: 'ignore', windowsHide: false });
        child.unref();
        return { success: true, pid: child.pid, path: exePath };
    } catch (err) {
        return { success: false, error: `Failed to launch Roblox: ${err.message}` };
    }
}

// ================================================================
// Open game via roblox-player protocol (full join URL format)
// ================================================================

function openGame(placeId, opts) {
    opts = opts || {};
    const launchMode = opts.launchMode || 'play';
    const jobId = opts.jobId || '';
    const privateServerLinkCode = opts.privateServerLinkCode || '';
    const browserTrackerId = opts.browserTrackerId || `tracker_${Date.now()}`;
    const launchTime = opts.launchTime || Date.now().toString();
    const authTicket = opts.authTicket || '';

    if (!placeId) {
        return { success: false, error: 'placeId is required' };
    }

    let launchUrl;

    if (launchMode === 'play') {
        const cleanJobId = jobId.trim();
        const cleanPrivateServerLinkCode = privateServerLinkCode.trim();
        const gameInstanceId = cleanJobId && !cleanJobId.startsWith('http')
            ? `+gameInstanceId:${cleanJobId}`
            : '';

        if (cleanPrivateServerLinkCode) {
            const baseUrl = 'https://assetgame.roblox.com/game/PlaceLauncher.ashx';
            const rawUrl = `${baseUrl}?request=RequestPrivateGame&browserTrackerId=${browserTrackerId}&placeId=${placeId}&linkCode=${cleanPrivateServerLinkCode}`;
            const encodedUrl = encodeURIComponent(rawUrl);
            launchUrl = `roblox-player:1+launchmode:play+gameinfo:${authTicket ? encodeURIComponent(authTicket) : ''}+launchtime:${launchTime}+placelauncherurl:${encodedUrl}+browsertrackerid:${browserTrackerId}+robloxLocale:en_us+gameLocale:en_us+channel:`;
        } else if (cleanJobId && cleanJobId.startsWith('http')) {
            const encodedUrl = encodeURIComponent(cleanJobId);
            launchUrl = `roblox-player:1+launchmode:play+gameinfo:${authTicket ? encodeURIComponent(authTicket) : ''}+launchtime:${launchTime}+placelauncherurl:${encodedUrl}+browsertrackerid:${browserTrackerId}+robloxLocale:en_us+gameLocale:en_us+channel:`;
        } else {
            const joinUrl = `https%3A%2F%2Fassetgame.roblox.com%2Fgame%2FPlaceLauncher.ashx%3Frequest%3DRequestGame%26browserTrackerId%3D${browserTrackerId}%26placeId%3D${placeId}%26isPlayTogetherGame%3Dfalse${encodeURIComponent(gameInstanceId.replace(/\+/g, '%2B'))}`;
            launchUrl = `roblox-player:1+launchmode:play+gameinfo:${authTicket ? encodeURIComponent(authTicket) : ''}+launchtime:${launchTime}+placelauncherurl:${joinUrl}+browsertrackerid:${browserTrackerId}+robloxLocale:en_us+gameLocale:en_us+channel:`;
        }
    } else if (launchMode === 'edit') {
        launchUrl = `roblox-player:1+launchmode:edit+placeId:${placeId}`;
    } else {
        return { success: false, error: `Unknown launch mode: ${launchMode}` };
    }

    try {
        if (IS_WIN) {
            execSync(`cmd /c start "" "${launchUrl}"`, { timeout: 5000, windowsHide: true });
        } else {
            execSync(`open "${launchUrl}"`, { timeout: 5000 });
        }
        return { success: true, launchUrl };
    } catch (err) {
        return { success: false, error: `Failed to open game: ${err.message}` };
    }
}

// ================================================================
// Screenshot capture (Windows only)
// ================================================================

function captureRobloxWindow(pid) {
    if (!IS_WIN) {
        return { success: false, error: 'Screenshot capture is only supported on Windows' };
    }

    try {
        const targetPid = pid || (listRobloxProcesses()[0] || {}).pid;
        if (!targetPid) {
            return { success: false, error: 'No Roblox process found to capture' };
        }

        const outputPath = path.join(os.tmpdir(), `roblox_ss_${Date.now()}.png`);

        // PowerShell script to capture a specific window by PID using .NET
        const psScript = `
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

        const result = execSync(
            `powershell -NoProfile -NonInteractive -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
            { encoding: 'utf-8', timeout: 10000 }
        );

        const trimmed = result.trim();
        if (trimmed.startsWith('CAPTURED:')) {
            const filePath = trimmed.substring(9);
            if (fs.existsSync(filePath)) {
                const base64 = fs.readFileSync(filePath, { encoding: 'base64' });
                fs.unlinkSync(filePath); // cleanup
                const stats = fs.statSync(filePath);
                return {
                    success: true,
                    pid: targetPid,
                    image: `data:image/png;base64,${base64}`,
                    sizeBytes: base64.length,
                };
            }
            return { success: false, error: 'Screenshot file was not created' };
        }

        return { success: false, error: trimmed || 'Unknown capture error' };

    } catch (err) {
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
