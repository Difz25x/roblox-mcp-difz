const { spawn, spawnSync } = require('child_process');
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
            const psRes = spawnSync(
                'powershell.exe',
                [
                    '-NoProfile',
                    '-NonInteractive',
                    '-Command',
                    "Get-Process | Where-Object { ($_.ProcessName -like '*Roblox*' -or $_.ProcessName -eq 'Bloxstrap') -and $_.ProcessName -notlike '*CrashHandler*' } | Select-Object Id, ProcessName, MainWindowTitle, WorkingSet64 | ConvertTo-Json -Compress"
                ],
                { encoding: 'utf-8', timeout: 3500, windowsHide: true }
            );
            output = (psRes.stdout || '').trim();

            if (output && output.trim()) {
                const parsed = JSON.parse(output);
                const procs = Array.isArray(parsed) ? parsed : [parsed];
                for (const p of procs) {
                    if (p.Id) {
                        results.push({
                            pid: p.Id,
                            name: p.ProcessName || ROBLOX_PROCESS,
                            windowTitle: p.MainWindowTitle || 'Roblox Window',
                            memoryMB: Math.round((p.WorkingSet64 || 0) / 1048576)
                        });
                    }
                }
            }

            // Fallback via tasklist if PowerShell returned no processes or failed
            if (results.length === 0) {
                try {
                    const taskRes = spawnSync('tasklist.exe', ['/FO', 'CSV', '/NH'], { encoding: 'utf-8', timeout: 3000, windowsHide: true });
                    const lines: string[] = (taskRes.stdout || '').split('\n');
                    for (const line of lines) {
                        const parts = line.split('","').map((s: string) => s.replace(/^"|"$/g, '').trim());
                        if (parts.length < 5) continue;
                        const imgName = parts[0] || '';
                        const imgLower = imgName.toLowerCase();
                        if ((imgLower.includes('roblox') || imgLower.includes('bloxstrap')) && !imgLower.includes('crashhandler')) {
                            const pid = parseInt(parts[1], 10);
                            if (!pid || isNaN(pid)) continue;
                            const memStr = parts[4] || '0';
                            const memKB = parseInt(memStr.replace(/[^0-9]/g, ''), 10) || 0;
                            results.push({
                                pid,
                                name: imgName.replace(/\.exe$/i, ''),
                                windowTitle: 'Roblox Window',
                                memoryMB: Math.round(memKB / 1024)
                            });
                        }
                    }
                } catch {}
            }
        } else {
            const psRes = spawnSync("ps", ["aux"], { encoding: 'utf-8', timeout: 3000 });
            output = psRes.stdout || '';
            const lines: string[] = output.split('\n').filter(l => l.trim());
            for (const line of lines) {
                const parts: string[] = line.split(/\s+/);
                if (parts.length < 11) continue;
                const name = parts[10] || '';
                const pid = parseInt(parts[1], 10);
                const memStr = parts[5] || '0';
                const nameLower: string = name.toLowerCase();
                if (!nameLower.includes('roblox') || nameLower.includes('crashhandler')) continue;
                results.push({ pid, name, windowTitle: parts.slice(10).join(' '), memoryMB: Math.round((parseInt(memStr, 10) || 0) / 1024) });
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
    if (IS_WIN) {
        // 1. Registry query for roblox-player protocol (covers modern installations)
        const regKeys = [
            'HKCU\\Software\\Classes\\roblox-player\\shell\\open\\command',
            'HKCR\\roblox-player\\shell\\open\\command',
            'HKLM\\SOFTWARE\\Classes\\roblox-player\\shell\\open\\command',
            'HKCU\\Software\\Classes\\roblox\\shell\\open\\command',
            'HKCR\\roblox\\shell\\open\\command'
        ];
        for (const regKey of regKeys) {
            try {
                const regRes = spawnSync('reg.exe', ['query', regKey], { encoding: 'utf-8', timeout: 3000, windowsHide: true });
                const regOutput: string = regRes.stdout || '';
                const match = regOutput.match(/"([^"]+\.exe)"/i) || regOutput.match(/([a-zA-Z]:\\[^\s"]+\.exe)/i);
                if (match && fs.existsSync(match[1])) {
                    return match[1];
                }
            } catch (e: any) { }
        }

        // 2. Scan standard installation and version directories
        const candidates: string[] = [
            process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Roblox', 'Versions') : '',
            process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Bloxstrap', 'Versions') : '',
            process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'Roblox', 'Versions') : '',
            process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Roblox', 'Versions') : '',
            'C:\\Program Files (x86)\\Roblox\\Versions',
            'C:\\Program Files\\Roblox\\Versions',
        ].filter(Boolean);

        for (const dir of candidates) {
            if (!fs.existsSync(dir)) continue;
            try {
                const versions: string[] = fs.readdirSync(dir).filter((v: string) => v.startsWith('version-')).sort().reverse();
                for (const ver of versions) {
                    const beta = path.join(dir, ver, 'RobloxPlayerBeta.exe');
                    if (fs.existsSync(beta)) return beta;
                    const launcher = path.join(dir, ver, 'RobloxPlayerLauncher.exe');
                    if (fs.existsSync(launcher)) return launcher;
                }
            } catch (e: any) { }
        }

        // 3. Bloxstrap standalone launcher
        if (process.env.LOCALAPPDATA) {
            const bloxstrap = path.join(process.env.LOCALAPPDATA, 'Bloxstrap', 'Bloxstrap.exe');
            if (fs.existsSync(bloxstrap)) return bloxstrap;
        }
    } else if (process.platform === 'darwin') {
        const macCandidates = [
            '/Applications/Roblox.app/Contents/MacOS/RobloxPlayer',
            path.join(os.homedir(), 'Applications/Roblox.app/Contents/MacOS/RobloxPlayer'),
        ];
        for (const p of macCandidates) {
            if (fs.existsSync(p)) return p;
        }
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
    if (exePath && fs.existsSync(exePath)) {
        try {
            // For RobloxPlayerBeta, passing '--app' opens the desktop client
            const args = path.basename(exePath).toLowerCase().includes('robloxplayerbeta') ? ['--app'] : [];
            const child = spawn(exePath, args, { detached: true, stdio: 'ignore', windowsHide: false });
            child.on('error', () => { });
            child.unref();
            if (child.pid !== undefined) {
                return { success: true, pid: child.pid, path: exePath };
            }
        } catch (err: any) {
            // Fall through to protocol launch if direct spawn fails
        }
    }

    // Protocol launch fallback (covers Windows Store apps, URI handlers, and custom setups)
    try {
        if (IS_WIN) {
            const child = spawn('cmd.exe', ['/c', 'start', '', 'roblox-player:'], {
                detached: true,
                stdio: 'ignore',
                windowsHide: true,
            });
            child.on('error', () => { });
            child.unref();
            return { success: true, path: 'roblox-player: (URI Protocol)' };
        } else if (process.platform === 'darwin') {
            const child = spawn('open', ['roblox-player:'], { detached: true, stdio: 'ignore' });
            child.on('error', () => { });
            child.unref();
            return { success: true, path: 'roblox-player: (URI Protocol)' };
        }
    } catch (e: any) {}

    return {
        success: false,
        error: 'Roblox not found. Please install Roblox from https://www.roblox.com or provide a custom executable path.',
    };
}

interface OpenGameOptions {
    launchMode?: string;
    launch_mode?: string;
    jobId?: string;
    job_id?: string;
    privateServerLinkCode?: string;
    private_server_link_code?: string;
    browserTrackerId?: string;
    browser_tracker_id?: string;
    launchTime?: string;
    launch_time?: string;
    authTicket?: string;
    auth_ticket?: string;
}

interface OpenGameResult {
    success: boolean;
    launchUrl?: string;
    error?: string;
}

function openGame(placeId: string | number, opts?: OpenGameOptions): OpenGameResult {
    opts = opts || {};
    const launchMode: string = opts.launchMode || opts.launch_mode || 'play';
    const jobId: string = opts.jobId || opts.job_id || '';
    const privateServerLinkCode: string = opts.privateServerLinkCode || opts.private_server_link_code || '';
    const browserTrackerId: string = opts.browserTrackerId || opts.browser_tracker_id || `tracker_${Date.now()}`;

    if (browserTrackerId && !/^[a-zA-Z0-9_-]+$/.test(browserTrackerId)) {
        return { success: false, error: 'Invalid browserTrackerId format' };
    }
    const launchTime: string = opts.launchTime || opts.launch_time || Date.now().toString();
    const authTicket: string = opts.authTicket || opts.auth_ticket || '';

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
    filePath?: string;
}

/**
 * Resolves where a captured artifact should be written.
 * An explicit `outputPath` wins; otherwise we fall back to the OS temp directory.
 */
function resolveOutputPath(outputPath: string | undefined, defaultName: string): string {
    if (outputPath && outputPath.trim() !== '') {
        const resolved = path.resolve(outputPath.trim());
        const dir = path.dirname(resolved);
        fs.mkdirSync(dir, { recursive: true });
        return resolved;
    }
    return path.join(os.tmpdir(), defaultName);
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
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            result.Add(new object[] { pid, hWnd.ToString(), string.IsNullOrEmpty(title) ? "Roblox Window" : title });
            return true;
        }, IntPtr.Zero);
        return result;
    }
}
"@
$robloxPids = @(Get-Process | Where-Object { ($_.ProcessName -like "*Roblox*" -or $_.ProcessName -eq "Bloxstrap") -and $_.ProcessName -notlike "*CrashHandler*" } | Select-Object -ExpandProperty Id)
if ($robloxPids.Count -eq 0) { Write-Output '[]'; exit }
$allWindows = [WinEnum]::GetVisibleWindows()
$found = @()
foreach ($w in $allWindows) {
    if ($robloxPids -contains [int]$w[0]) {
        $found += [PSCustomObject]@{ pid=[int]$w[0]; hwnd=$w[1]; title=$w[2] }
    }
}
if ($found.Count -eq 0) {
    $procsWithWindows = Get-Process | Where-Object { ($_.ProcessName -like "*Roblox*" -or $_.ProcessName -eq "Bloxstrap") -and $_.ProcessName -notlike "*CrashHandler*" -and $_.MainWindowHandle -ne 0 }
    foreach ($p in $procsWithWindows) {
        $found += [PSCustomObject]@{ pid=[int]$p.Id; hwnd=$p.MainWindowHandle.ToString(); title=$(if ($p.MainWindowTitle) { $p.MainWindowTitle } else { "Roblox Window" }) }
    }
}
if ($found.Count -eq 0) { Write-Output '[]' } else { $found | ConvertTo-Json -Compress }
`;
    try {
        const raw = runPowerShellScript(ps, 15000).trim();
        if (!raw || raw === "null") return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch { return []; }

}

/**
 * Brings a window to the foreground and verifies it is genuinely unobstructed
 * before we sample screen pixels from its rectangle.
 *
 * Why this exists: `CopyFromScreen` copies whatever pixels currently occupy the
 * given screen coordinates. If another app (a browser, a chat window) sits on
 * top of the Roblox window, we would silently capture that app instead. Windows
 * also routinely refuses `SetForegroundWindow` (foreground-lock), which used to
 * fail silently here.
 *
 * The shared PowerShell prologue below:
 *   1. Defines POINT locally -- the previous `ref System.Drawing.Point` signature
 *      did not compile (Add-Type has no System.Drawing reference at compile time),
 *      so the whole WinCapture class failed to build and every screenshot errored.
 *   2. Restores + raises the target window, retrying until it owns the foreground.
 *   3. Confirms with WindowFromPoint that the topmost window at the capture rect's
 *      centre belongs to the target process. Returns CAPTURE_OK only then.
 */
/**
 * Runs a PowerShell script reliably using a temporary script file to prevent
 * syntax issues with multiline here-strings over stdin or CLI length limits.
 */
function runPowerShellScript(ps: string, timeoutMs: number): string {
    const tmpFile = path.join(os.tmpdir(), `rblx_ps_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`);
    try {
        fs.writeFileSync(tmpFile, ps, 'utf-8');
        const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmpFile], {
            encoding: 'utf-8',
            timeout: timeoutMs,
            windowsHide: true,
            maxBuffer: 25 * 1024 * 1024,
        });
        if (res.error) {
            throw res.error;
        }
        return res.stdout || '';
    } finally {
        try {
            if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
        } catch {}
    }
}

function buildCapturePrologue(hwnd: string, pid: number): string {
    return `
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinCapture {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X, Y; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
    public static void ForceForeground(IntPtr hWnd) {
        ShowWindow(hWnd, 9);
        ShowWindow(hWnd, 5);
        keybd_event(0x12, 0, 0, UIntPtr.Zero);
        keybd_event(0x12, 0, 2, UIntPtr.Zero);
        SetForegroundWindow(hWnd);
        BringWindowToTop(hWnd);
    }
}
"@
$hwnd = [IntPtr]::new([long]${hwnd})
$targetPid = ${pid}

if (-not [WinCapture]::IsWindow($hwnd)) { Write-Output 'ERR:WINDOW_GONE'; exit 1 }
if ([WinCapture]::IsIconic($hwnd)) {
    [WinCapture]::ShowWindow($hwnd, 9) | Out-Null
    Start-Sleep -Milliseconds 250
}

# Raise the window and wait until it actually owns the foreground.
[WinCapture]::ForceForeground($hwnd)
Start-Sleep -Milliseconds 150
$raised = $false
for ($attempt = 0; $attempt -lt 8; $attempt++) {
    [WinCapture]::ForceForeground($hwnd)
    Start-Sleep -Milliseconds 80
    if ([WinCapture]::GetForegroundWindow() -eq $hwnd) { $raised = $true; break }
}
if (-not $raised) {
    Start-Sleep -Milliseconds 150
}

$rect = New-Object WinCapture+RECT
[WinCapture]::GetClientRect($hwnd, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left; $h = $rect.Bottom - $rect.Top
if ($w -le 0 -or $h -le 0) { Write-Output 'ERR:ZERO_SIZE'; exit 1 }

$pt = New-Object WinCapture+POINT
[WinCapture]::ClientToScreen($hwnd, [ref]$pt) | Out-Null

# Occlusion gate: sample the topmost window at the centre of the capture rect.
# If it is not our target process, another app is covering Roblox and sampling
# screen pixels would capture the wrong application.
$centerPt = New-Object WinCapture+POINT
$centerPt.X = $pt.X + [int]($w / 2)
$centerPt.Y = $pt.Y + [int]($h / 2)
$topHwnd = [WinCapture]::WindowFromPoint($centerPt)
$topPid = 0
[WinCapture]::GetWindowThreadProcessId($topHwnd, [ref]$topPid) | Out-Null
if ($topPid -ne $targetPid) {
    $rootHwnd = [WinCapture]::GetAncestor($topHwnd, 2)
    $rootPid = 0
    [WinCapture]::GetWindowThreadProcessId($rootHwnd, [ref]$rootPid) | Out-Null
    if ($rootPid -ne $targetPid) {
        Write-Output "ERR:OCCLUDED:$topPid"
        exit 1
    }
}
`;
}

function captureWindowPNG(hwnd: string, pid: number): string {
    if (!/^\d+$/.test(hwnd)) throw new Error("Invalid hwnd");
    const ps = `${buildCapturePrologue(hwnd, pid)}
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($pt.X, $pt.Y, 0, 0, $bmp.Size, [System.Drawing.CopyPixelOperation]::SourceCopy)
$gfx.Dispose()

$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
$bytes = $ms.ToArray(); $ms.Dispose()
$b64 = [Convert]::ToBase64String($bytes)
Write-Output "B64_DATA:$b64"
`;
    const stdout = runPowerShellScript(ps, 20000).trim();

    if (stdout.includes('ERR:WINDOW_GONE')) throw new Error("Roblox window closed before capture");
    if (stdout.includes('ERR:ZERO_SIZE')) throw new Error("Roblox window has zero size (minimised?)");
    if (stdout.includes('ERR:OCCLUDED')) {
        throw new Error(
            "Roblox window is covered by another application. " +
            "Bring it to the front and retry."
        );
    }
    const marker = 'B64_DATA:';
    const idx = stdout.indexOf(marker);
    if (idx === -1) throw new Error("Capture produced no output");
    const result = stdout.slice(idx + marker.length).trim();
    if (!result) throw new Error("Capture produced empty output");
    return result;
}

async function performScreenshot(pid?: number, outputPath?: string): Promise<ScreenshotResult> {
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
    const target = targets[0];
    try {
        const imageBase64 = captureWindowPNG(target.hwnd, target.pid);
        const filePath = resolveOutputPath(outputPath, `roblox_shot_${target.pid}_${Date.now()}.png`);
        fs.writeFileSync(filePath, Buffer.from(imageBase64, 'base64'));

        // When the caller asked for a specific destination, return the path only --
        // there is no need to ship a multi-megabyte base64 blob back as well.
        if (outputPath && outputPath.trim() !== '') {
            return { filePath, pid: target.pid };
        }
        return { imageBase64, filePath, pid: target.pid };
    } catch (err: any) {
        return { error: `Failed to capture window: ${err.message}` };
    }
}

async function recordVideo(
    pid?: number,
    duration: number = 5,
    outputPath?: string,
    fps: number = 30
): Promise<ScreenshotResult & { filePath?: string }> {
    const windows = enumRobloxWindows();
    if (windows.length === 0) {
        return { error: "No visible Roblox windows found." };
    }
    let targets = windows;
    if (pid !== undefined) {
        targets = windows.filter((w) => w.pid === pid);
        if (targets.length === 0) {
            return { error: `No Roblox window for PID ${pid}. Available:` + windows.map((w) => `  PID ${w.pid} - "${w.title}"`).join("") };
        }
    }
    if (targets.length > 1) {
        return { needsDisambiguation: true, windows: targets };
    }

    try {
        const targetPid = targets[0].pid;

        const durationSecs = Math.min(Math.max(1, duration), 30);
        const targetFps = Math.min(Math.max(1, Number(fps) || 30), 60);
        const outFile = resolveOutputPath(outputPath, `roblox_rec_${targetPid}_${Date.now()}.mp4`);

        // Reuses the shared prologue: compiles WinCapture correctly, raises the window,
        // and aborts if another application is covering the capture region.
        const ps = `${buildCapturePrologue(targets[0].hwnd, targetPid)}
$duration = ${durationSecs}
$fps = ${targetFps}
$frames = $duration * $fps
$frameDelayMs = 1000 / $fps

$outFolder = Join-Path $env:TEMP "roblox_frames_${targetPid}_$(Get-Date -UFormat '%s')"
New-Item -ItemType Directory -Path $outFolder | Out-Null

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$occluded = 0

for ($i = 0; $i -lt $frames; $i++) {
    $loopStart = $sw.ElapsedMilliseconds

    # Re-check occlusion each frame: a window can steal focus mid-recording, which
    # would otherwise splice unrelated application pixels into the video.
    $centerPt = New-Object WinCapture+POINT
    $centerPt.X = $pt.X + [int]($w / 2)
    $centerPt.Y = $pt.Y + [int]($h / 2)
    $topHwnd = [WinCapture]::WindowFromPoint($centerPt)
    $topPid = 0
    [WinCapture]::GetWindowThreadProcessId($topHwnd, [ref]$topPid) | Out-Null
    if ($topPid -ne $targetPid) {
        $rootHwnd = [WinCapture]::GetAncestor($topHwnd, 2)
        $rootPid = 0
        [WinCapture]::GetWindowThreadProcessId($rootHwnd, [ref]$rootPid) | Out-Null
        if ($rootPid -ne $targetPid) {
            $occluded++
            [WinCapture]::SetForegroundWindow($hwnd) | Out-Null
            Start-Sleep -Milliseconds 60
            continue
        }
    }

    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    $gfx.CopyFromScreen($pt.X, $pt.Y, 0, 0, $bmp.Size, [System.Drawing.CopyPixelOperation]::SourceCopy)
    $gfx.Dispose()

    $fileName = "frame_{0:D4}.jpg" -f $i
    $bmp.Save((Join-Path $outFolder $fileName), [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $bmp.Dispose()

    $elapsed = $sw.ElapsedMilliseconds - $loopStart
    $sleepTime = $frameDelayMs - $elapsed
    if ($sleepTime -gt 0) {
        Start-Sleep -Milliseconds [Math]::Round($sleepTime)
    }
}

if ($occluded -ge $frames) {
    Remove-Item -Recurse -Force $outFolder -ErrorAction SilentlyContinue
    Write-Output 'ERR:OCCLUDED'
    exit 1
}

Write-Output "FRAMES_OK:$outFolder"
`;

        const psResult = runPowerShellScript(ps, (durationSecs * 1000) + 25000);

        const lines = psResult.trim().split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
        if (lines.some((l: string) => l.includes('ERR:WINDOW_GONE'))) {
            return { error: "Roblox window closed before recording started." };
        }
        if (lines.some((l: string) => l.includes('ERR:ZERO_SIZE'))) {
            return { error: "Roblox window has zero size (minimised?)." };
        }
        if (lines.some((l: string) => l.includes('ERR:OCCLUDED'))) {
            return { error: "Roblox window was covered by another application for the whole recording. Bring it to the front and retry." };
        }

        const framesLine = lines.find((l: string) => l.startsWith('FRAMES_OK:')) || '';
        const frameFolder = framesLine.replace('FRAMES_OK:', '').trim();
        if (!frameFolder || !fs.existsSync(frameFolder)) {
            return { error: "Failed to record video frames." };
        }

        let hasFfmpeg = true;
        try { spawnSync("ffmpeg", ["-version"], { stdio: 'ignore', windowsHide: true }); } catch { hasFfmpeg = false; }

        if (hasFfmpeg) {
            // Pad width and height to be divisible by 2 for yuv420p compliance
            spawnSync("ffmpeg", [
                "-y",
                "-framerate", String(targetFps),
                "-i", path.join(frameFolder, "frame_%04d.jpg"),
                "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                "-c:v", "libx264",
                "-preset", "ultrafast",
                "-pix_fmt", "yuv420p",
                outFile
            ], { stdio: 'ignore', windowsHide: true });
            try { fs.rmSync(frameFolder, { recursive: true, force: true }); } catch { }
            return { pid: targetPid, filePath: outFile };
        } else {
            return { pid: targetPid, filePath: frameFolder, error: "ffmpeg not installed. Raw frames saved to folder instead of video." };
        }
    } catch (err: any) {
        return { error: `Failed to record window: ${err.message}` };
    }
}

function killProcess(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        if (IS_WIN) {
            spawnSync("taskkill", ["/F", "/PID", String(pid)], { stdio: 'ignore', windowsHide: true });
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
