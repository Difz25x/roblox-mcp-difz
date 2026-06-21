"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * process-manager.ts — Roblox process management (Node side)
 */
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const IS_WIN = os.platform() === 'win32';
function listRobloxProcesses() {
    const results = [];
    try {
        const output = IS_WIN
            ? execSync('tasklist /FO CSV /NH /V', { encoding: 'utf-8', timeout: 5000 })
            : execSync("ps aux | grep -i roblox || true", { encoding: 'utf-8', timeout: 5000 });
        for (const line of output.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            let pid, name, windowTitle, memStr;
            if (IS_WIN) {
                const parts = trimmed.match(/"([^"]*)"/g);
                if (!parts || parts.length < 5)
                    continue;
                name = parts[0].replace(/"/g, '');
                pid = parseInt(parts[1].replace(/"/g, ''), 10);
                memStr = parts[4].replace(/[^0-9,]/g, '').replace(',', '');
                windowTitle = parts.length > 8 ? parts[8].replace(/"/g, '') : '';
            }
            else {
                const parts = trimmed.split(/\s+/);
                if (parts.length < 11)
                    continue;
                name = parts[10] || '';
                pid = parseInt(parts[1], 10);
                memStr = parts[5] || '0';
                windowTitle = parts.slice(10).join(' ');
            }
            const nl = name.toLowerCase();
            if (!nl.includes('roblox') && !windowTitle.toLowerCase().includes('roblox'))
                continue;
            if (nl.includes('launcher'))
                continue;
            results.push({ pid, name: name || 'RobloxPlayerBeta', windowTitle, memoryMB: parseInt(memStr, 10) || 0 });
        }
    }
    catch (e) {
        console.error('[PM] listRobloxProcesses error:', e?.message || e);
    }
    return results;
}
function findRobloxPath() {
    try {
        const out = execSync('reg query "HKLM\\SOFTWARE\\Roblox\\RobloxStudio" /v Location 2>nul || ' +
            'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Roblox\\RobloxStudio" /v Location 2>nul', { encoding: 'utf-8', timeout: 3000 });
        const m = out.match(/Location\s+REG_SZ\s+(.+)/);
        if (m && fs.existsSync(path.join(m[1].trim(), 'RobloxPlayerLauncher.exe')))
            return path.join(m[1].trim(), 'RobloxPlayerLauncher.exe');
    }
    catch (e) {
        console.error('[PM] registry error:', e?.message || e);
    }
    const candidates = [
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Roblox', 'Versions') : '',
        'C:\\Program Files (x86)\\Roblox\\Versions', 'C:\\Program Files\\Roblox\\Versions',
    ];
    for (const dir of candidates) {
        if (!dir || !fs.existsSync(dir))
            continue;
        try {
            for (const ver of fs.readdirSync(dir).filter((v) => v.startsWith('version-')).sort().reverse()) {
                const lp = path.join(dir, ver, 'RobloxPlayerLauncher.exe');
                if (fs.existsSync(lp))
                    return lp;
            }
        }
        catch (e) {
            console.error('[PM] readdir error:', e?.message || e);
        }
    }
    return null;
}
function launchRoblox(customPath) {
    const exePath = customPath || findRobloxPath();
    if (!exePath)
        return { success: false, error: 'Roblox not found.' };
    if (!fs.existsSync(exePath))
        return { success: false, error: `Not found: ${exePath}` };
    try {
        const child = spawn(exePath, [], { detached: true, stdio: 'ignore', windowsHide: false });
        child.unref();
        return { success: true, pid: child.pid, path: exePath };
    }
    catch (err) {
        return { success: false, error: err.message };
    }
}
function openGame(placeId, opts = {}) {
    if (!placeId)
        return { success: false, error: 'placeId is required' };
    const lm = opts.launchMode || 'play';
    const jid = (opts.jobId || '').trim();
    const psc = (opts.privateServerLinkCode || '').trim();
    const bt = opts.browserTrackerId || `tracker_${Date.now()}`;
    const lt = opts.launchTime || Date.now().toString();
    const at = opts.authTicket || '';
    let url;
    if (lm === 'play') {
        const gii = jid && !jid.startsWith('http') ? `+gameInstanceId:${jid}` : '';
        if (psc) {
            url = `roblox-player:1+launchmode:play+gameinfo:${at ? encodeURIComponent(at) : ''}+launchtime:${lt}+placelauncherurl:${encodeURIComponent('https://assetgame.roblox.com/game/PlaceLauncher.ashx?request=RequestPrivateGame&browserTrackerId=' + bt + '&placeId=' + placeId + '&linkCode=' + psc)}+browsertrackerid:${bt}+robloxLocale:en_us+gameLocale:en_us+channel:`;
        }
        else if (jid && jid.startsWith('http')) {
            url = `roblox-player:1+launchmode:play+gameinfo:${at ? encodeURIComponent(at) : ''}+launchtime:${lt}+placelauncherurl:${encodeURIComponent(jid)}+browsertrackerid:${bt}+robloxLocale:en_us+gameLocale:en_us+channel:`;
        }
        else {
            url = `roblox-player:1+launchmode:play+gameinfo:${at ? encodeURIComponent(at) : ''}+launchtime:${lt}+placelauncherurl:https%3A%2F%2Fassetgame.roblox.com%2Fgame%2FPlaceLauncher.ashx%3Frequest%3DRequestGame%26browserTrackerId%3D${bt}%26placeId%3D${placeId}%26isPlayTogetherGame%3Dfalse${gii.replace(/\+/g, '%2B')}+browsertrackerid:${bt}+robloxLocale:en_us+gameLocale:en_us+channel:`;
        }
    }
    else if (lm === 'edit') {
        url = `roblox-player:1+launchmode:edit+placeId:${placeId}`;
    }
    else
        return { success: false, error: `Unknown mode: ${lm}` };
    try {
        if (IS_WIN) {
            const p = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true });
            p.unref();
        }
        else {
            const p = spawn('open', [url], { detached: true, stdio: 'ignore' });
            p.unref();
        }
        return { success: true, launchUrl: url };
    }
    catch (err) {
        return { success: false, error: err.message };
    }
}
function captureRobloxWindow(pid) {
    if (!IS_WIN)
        return { success: false, error: 'Windows only' };
    try {
        const tp = pid || (listRobloxProcesses()[0] || {}).pid;
        if (!tp)
            return { success: false, error: 'No Roblox process' };
        const op = path.join(os.tmpdir(), `roblox_ss_${Date.now()}.png`);
        const ps = `Add-Type -AssemblyName System.Drawing\nAdd-Type @"\nusing System;using System.Runtime.InteropServices;using System.Drawing;\npublic class Capture{\n[DllImport("user32.dll")]public static extern IntPtr GetWindowThreadProcessId(IntPtr hWnd,out int pid);\n[DllImport("user32.dll")]public static extern IntPtr FindWindow(string c,string t);\n[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr hWnd,out RECT r);\n[DllImport("user32.dll")]public static extern IntPtr WindowFromPoint(long point);\n[DllImport("user32.dll")]public static extern IntPtr GetDesktopWindow();\n[DllImport("user32.dll")]public static extern IntPtr GetWindowDC(IntPtr hWnd);\n[DllImport("user32.dll")]public static extern bool PrintWindow(IntPtr hWnd,IntPtr hdcBlt,int nFlags);\n[DllImport("gdi32.dll")]public static extern bool DeleteDC(IntPtr hdc);\n[DllImport("gdi32.dll")]public static extern bool DeleteObject(IntPtr hObject);\npublic struct RECT{public int Left;public int Top;public int Right;public int Bottom;}\npublic static Bitmap CaptureWindow(IntPtr hWnd){\nRECT r;GetWindowRect(hWnd,out r);\nint w=r.Right-r.Left;int h=r.Bottom-r.Top;\nif(w<=0||h<=0)return null;\nBitmap bmp=new Bitmap(w,h);\nGraphics gfx=Graphics.FromImage(bmp);\nIntPtr hdc=gfx.GetHdc();\nPrintWindow(hWnd,hdc,0);\ngfx.ReleaseHdc(hdc);\ngfx.Dispose();\nreturn bmp;\n}\n}"@\n$tp=` + tp + `\n$procs=[System.Diagnostics.Process]::GetProcesses()\nforeach($p in $procs){if($p.Id-eq $tp-and $p.MainWindowHandle-ne [IntPtr]::Zero){$bmp=[Capture]::CaptureWindow($p.MainWindowHandle);if($bmp){$bmp.Save("` + op + `",[System.Drawing.Imaging.ImageFormat]::Png);$bmp.Dispose();Write-Output "CAPTURED:` + op + `"}else{Write-Output "ERROR:null"};exit}}\nWrite-Output "ERROR:not found"\n`;
        const pf = path.join(os.tmpdir(), `rc_${Date.now()}.ps1`);
        fs.writeFileSync(pf, ps, 'utf-8');
        const r = execSync(`powershell -NoProfile -NonInteractive -File "${pf}"`, { encoding: 'utf-8', timeout: 10000 });
        try {
            fs.unlinkSync(pf);
        }
        catch { }
        const t = r.trim();
        if (t.startsWith('CAPTURED:')) {
            const fp = t.substring(9);
            if (fs.existsSync(fp)) {
                const b64 = fs.readFileSync(fp, { encoding: 'base64' });
                const sz = b64.length;
                fs.unlinkSync(fp);
                return { success: true, pid: tp, image: `data:image/png;base64,${b64}`, sizeBytes: sz };
            }
            return { success: false, error: 'File not created' };
        }
        return { success: false, error: t || 'Unknown error' };
    }
    catch (err) {
        return { success: false, error: err.message };
    }
}
module.exports = { listRobloxProcesses, launchRoblox, openGame, findRobloxPath, captureRobloxWindow };
