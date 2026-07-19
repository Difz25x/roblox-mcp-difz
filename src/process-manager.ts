const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const IS_WIN: boolean = process.platform === 'win32';
const ROBLOX_PROCESS: string = 'RobloxPlayerBeta';

interface RobloxProcessInfo {
    pid: number;
    name: string;
    windowTitle: string;
    memoryMB: number;
}

let _procCache: { data: RobloxProcessInfo[]; time: number } | null = null;
const PROC_CACHE_TTL = 3000;

function listRobloxProcesses(): RobloxProcessInfo[] {
    const now = Date.now();
    if (_procCache && now - _procCache.time < PROC_CACHE_TTL) {
        return _procCache.data;
    }

    const results: RobloxProcessInfo[] = [];
    try {
        let output: string;
        if (IS_WIN) {
            output = execSync(
                `powershell -NoProfile -NonInteractive -Command "Get-Process -Name 'RobloxPlayerBeta' -ErrorAction SilentlyContinue | Select-Object Id, MainWindowTitle, WorkingSet64 | ConvertTo-Json -Compress"`,
                { encoding: 'utf-8' as BufferEncoding, timeout: 3000, windowsHide: true }
            ) as string;

            if (output && output.trim()) {
                const parsed = JSON.parse(output);
                const procs = Array.isArray(parsed) ? parsed : [parsed];
                for (const p of procs) {
                    if (p.Id) {
                        results.push({
                            pid: p.Id,
                            name: ROBLOX_PROCESS,
                            windowTitle: p.MainWindowTitle || '',
                            memoryMB: Math.round((p.WorkingSet64 || 0) / 1048576)
                        });
                    }
                }
            }
        } else {
            output = execSync("ps aux | grep -i roblox || true", { encoding: 'utf-8' as BufferEncoding, timeout: 3000 }) as string;
            const lines: string[] = output.split('\n').filter(l => l.trim());
            for (const line of lines) {
                const parts: string[] = line.split(/\s+/);
                if (parts.length < 11) continue;
                const name = parts[10] || '';
                const pid = parseInt(parts[1], 10);
                const memStr = parts[5] || '0';
                const nameLower: string = name.toLowerCase();
                if (!nameLower.includes('roblox')) continue;
                results.push({ pid, name, windowTitle: parts.slice(10).join(' '), memoryMB: parseInt(memStr, 10) || 0 });
            }
        }
    } catch (e: any) {
        if (_procCache) {
            _procCache.time = Date.now(); // bump TTL so we don't spam errors
            return _procCache.data;
        }
    }

    _procCache = { data: results, time: Date.now() };
    return results;
}

function findRobloxPath(): string | null {
    if (!IS_WIN) {
        return null;
    }

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
        child.on('error', () => { }); // Catch spawn errors silently
        child.unref();
        if (child.pid === undefined) return { success: false, error: 'Failed to spawn process' };
        return { success: true, pid: child.pid, path: exePath };
    } catch (err: any) {
        return { success: false, error: `Failed to launch Roblox: ${err.message}` };
    }
}

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

function openGame(placeId: string | number, opts?: OpenGameOptions): OpenGameResult {
    opts = opts || {};
    const launchMode: string = opts.launchMode || 'play';
    const jobId: string = opts.jobId || '';
    const privateServerLinkCode: string = opts.privateServerLinkCode || '';
    const browserTrackerId: string = opts.browserTrackerId || `tracker_${Date.now()}`;

    if (opts.browserTrackerId && !/^[a-zA-Z0-9_-]+$/.test(opts.browserTrackerId)) {
        return { success: false, error: 'Invalid browserTrackerId format' };
    }
    const launchTime: string = opts.launchTime || Date.now().toString();
    const authTicket: string = opts.authTicket || '';

    if (!placeId) {
        return { success: false, error: 'placeId is required' };
    }
    if (!/^\d+$/.test(String(placeId))) {
        return { success: false, error: 'placeId must be numeric' };
    }
    if (jobId && !/^[a-zA-Z0-9\-]+$/.test(jobId) && !jobId.startsWith('http')) {
        return { success: false, error: 'Invalid jobId format' };
    }
    if (privateServerLinkCode && !/^[a-zA-Z0-9\-_]+$/.test(privateServerLinkCode)) {
        return { success: false, error: 'Invalid privateServerLinkCode format' };
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
            start.on('error', () => { });
            start.unref();
        } else {
            const open = spawn('open', [launchUrl], {
                detached: true, stdio: 'ignore',
            });
            open.on('error', () => { });
            open.unref();
        }
        return { success: true, launchUrl };
    } catch (err: any) {
        return { success: false, error: `Failed to open game: ${err.message}` };
    }
}

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
    pid?: number;
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
    try {
        const encodedScript = Buffer.from(ps, 'utf16le').toString('base64');
        const raw = execSync(
            `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand "${encodedScript}"`,
            { encoding: "utf-8" as BufferEncoding, timeout: 15000, windowsHide: true }
        ).trim();
        if (!raw || raw === "null") return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch { return []; }

}

function captureWindowPNG(hwnd: string): string {
    if (!/^\d+$/.test(hwnd)) throw new Error("Invalid hwnd");
    const outFile = path.join(os.tmpdir(), `roblox_ss_${Date.now()}.b64`);
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
[System.IO.File]::WriteAllText('${outFile}', $b64)
Write-Output 'OK'
`;
    try {
        const encodedScript = Buffer.from(ps, 'utf16le').toString('base64');
        execSync(
            `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand "${encodedScript}"`,
            { encoding: "utf-8" as BufferEncoding, timeout: 15000, windowsHide: true }
        );
        if (!fs.existsSync(outFile)) throw new Error("No output");
        const result = fs.readFileSync(outFile, "utf-8").trim();
        if (!result) throw new Error("Empty output");
        return result;
    } finally {

        try { fs.unlinkSync(outFile); } catch { }
    }
}

async function performScreenshot(pid?: number): Promise<ScreenshotResult> {
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
    if (targets.length > 1) {
        return { needsDisambiguation: true, windows: targets };
    }
    try {
        const imageBase64 = captureWindowPNG(targets[0].hwnd);
        return { imageBase64, pid: targets[0].pid };
    } catch (err: any) {
        return { error: `Failed to capture window: ${err.message}` };
    }
}

async function recordVideo(pid?: number, duration: number = 5): Promise<ScreenshotResult & { filePath?: string }> {
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
    if (targets.length > 1) {
        return { needsDisambiguation: true, windows: targets };
    }

    try {
        const targetPid = targets[0].pid;
        const outFile = path.join(os.tmpdir(), `roblox_rec_${targetPid}_${Date.now()}.mp4`);
        const durationSecs = Math.min(Math.max(1, duration), 30);

        // We will use PowerShell and ffmpeg (via winget if not available or just rely on ffmpeg being in PATH, but if not we can use ScreenCapture api using PowerShell)
        // Since ffmpeg is not guaranteed to be installed, we can record a series of screenshots and compile them, or use SnippingTool API/Graphics.CopyFromScreen.
        // Actually, Windows has a built-in "ScreenCapture" via MediaFoundation or we can just make a quick loop of screenshots and pack them into a basic format, but that is heavy.
        // Let's use PowerShell to capture frames and save them. We'll use a PS script to record the screen area of the window.
        // Actually, the easiest reliable way without external dependencies (ffmpeg) is just grabbing ~10 FPS using PrintWindow and returning the frames or an animated GIF, but it's large.
        // Since we want video, and if ffmpeg is not guaranteed, let's create a GIF using PowerShell!

        const ps = `
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinCapture {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern IntPtr GetWindowDC(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hDC, uint nFlags);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$hwnd = [IntPtr]::new([long]${targets[0].hwnd})
if ([WinCapture]::IsIconic($hwnd)) { [WinCapture]::ShowWindow($hwnd, 9) | Out-Null; Start-Sleep -Milliseconds 200 }

$rect = New-Object WinCapture+RECT
[WinCapture]::GetClientRect($hwnd, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left; $h = $rect.Bottom - $rect.Top
if ($w -le 0 -or $h -le 0) { Write-Error "Zero size"; exit 1 }

$duration = ${durationSecs}
$fps = 30
$frames = $duration * $fps

$outFolder = Join-Path $env:TEMP "roblox_frames_$(${targets[0].pid})_$(Get-Date -UFormat '%s')"
New-Item -ItemType Directory -Path $outFolder | Out-Null

for ($i = 0; $i -lt $frames; $i++) {
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc = $gfx.GetHdc()
    [WinCapture]::PrintWindow($hwnd, $hdc, 2) | Out-Null
    $gfx.ReleaseHdc($hdc)
    $gfx.Dispose()

    $bmp.Save((Join-Path $outFolder "frame_$i.jpg"), [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $bmp.Dispose()
    Start-Sleep -Milliseconds (1000 / $fps)
}

Write-Output $outFolder
        `;

        const encodedScript = Buffer.from(ps, 'utf16le').toString('base64');
        const psResult = execSync(
            `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand "${encodedScript}"`,
            { encoding: "utf-8" as BufferEncoding, timeout: (durationSecs * 1000) + 15000, windowsHide: true }
        );

        const frameFolder = psResult.trim().split('\\n').pop()?.trim() || "";
        if (!fs.existsSync(frameFolder)) {
            return { error: "Failed to record video frames." };
        }

        // Check if ffmpeg exists to create mp4
        let hasFfmpeg = true;
        try { execSync("ffmpeg -version", { stdio: 'ignore' }); } catch { hasFfmpeg = false; }

        if (hasFfmpeg) {
            execSync(`ffmpeg -y -framerate 5 -i "${path.join(frameFolder, 'frame_%d.jpg')}" -c:v libx264 -pix_fmt yuv420p "${outFile}"`, { stdio: 'ignore', windowsHide: true });
            try { fs.rmSync(frameFolder, { recursive: true, force: true }); } catch { }
            return { pid: targetPid, filePath: outFile };
        } else {
            // Return folder path directly since ffmpeg is missing
            return { pid: targetPid, filePath: frameFolder, error: "ffmpeg not installed. Raw frames saved to folder instead of video." };
        }
    } catch (err: any) {
        return { error: `Failed to record window: ${err.message}` };
    }
}


function killProcess(pid: number): boolean {
    try {
        if (IS_WIN) {
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        } else {
            process.kill(pid, 'SIGKILL');
        }
        _procCache = null;
        return true;
    } catch (err) {
        return false;
    }
}

module.exports = {
    listRobloxProcesses,
    launchRoblox,
    openGame,
    findRobloxPath,
    isSupported,
    enumRobloxWindows,
    performScreenshot,
    recordVideo,
    killProcess,
};
