#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync, appendFileSync } from "node:fs";
import os from "node:os";
import readline from "node:readline";

if (process.env.npm_command === "publish") { process.exit(0); }

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force") || args.includes("-f");
const otpFlag = args.includes("--otp");
const otp = otpFlag ? args[args.indexOf("--otp") + 1] : undefined;
const tokenFlag = args.includes("--token");
const publishToken = tokenFlag ? args[args.indexOf("--token") + 1] : (process.env.NPM_TOKEN || "");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const tag = `v${pkg.version}`;
const [major, minor, patch] = pkg.version.split('.').map(Number);

function spawn(command, args, options = {}) {
    if (process.platform === "win32" && command === "npm") {
        return spawnSync("cmd.exe", ["/d", "/s", "/c", commandLine([command, ...args])], { windowsHide: true, ...options });
    }
    return spawnSync(command, args, { windowsHide: true, ...options });
}

function run(command, args) {
    const result = spawn(command, args, { stdio: "inherit" });
    if (result.error) { console.error(result.error.message); process.exit(1); }
    if (result.status !== 0) { process.exit(result.status ?? 1); }
}

function output(cmd, args) {
    const result = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true });
    return (result.status === 0 ? (result.stdout || "").trim() : "");
}

function outputShell(cmd) {
    const result = spawnSync("cmd.exe", ["/d", "/s", "/c", cmd], { encoding: "utf8", windowsHide: true });
    return (result.status === 0 ? (result.stdout || "").trim() : "");
}

function commandLine(args) { return args.map(q => /^[A-Za-z0-9_./:=@-]+$/.test(q) ? q : `"${q.replace(/(["\\])/g, "\\$1")}"`).join(" "); }

function hasStagedChanges() {
    const result = spawn("git", ["diff", "--cached", "--quiet"]);
    if (result.status === 0) return false;
    if (result.status === 1) return true;
    process.exit(result.status ?? 1);
}

function prompt(query) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(query, (a) => { rl.close(); resolve(a.trim().toLowerCase()); });
    });
}

async function ensureTag() {
    const current = output("git", ["rev-parse", "HEAD"]);
    const tagged = output("git", ["rev-list", "-n", "1", tag]);
    if (!tagged) { run("git", ["tag", tag]); return; }
    if (tagged === current) return;

    const oldMsg = output("git", ["log", "--oneline", "-1", tagged]) || "(unknown)";
    const curMsg = output("git", ["log", "--oneline", "-1", current]) || "(unknown)";
    console.error(`\n⚠️  Tag ${tag} already exists on a different commit:\n   Tag commit: ${oldMsg}\n   Current:     ${curMsg}\n`);

    if (force) { console.error(`   --force. Redeploying.`); run("git", ["tag", "-d", tag]); run("git", ["tag", tag]); process.env.FORCE_PUSH = "1"; return; }

    const isAncestor = outputShell(`git merge-base --is-ancestor ${tagged} ${current} && echo yes || echo no`);
    if (isAncestor === "yes") { console.error(`   ✓ Ancestor — safe.`); run("git", ["tag", "-d", tag]); run("git", ["tag", tag]); return; }

    console.error(`   Choose:\n     1. Force tag + force push\n     2. Bump to v${major}.${minor}.${patch + 1}\n     3. Abort\n`);
    const answer = await prompt(`   Enter (1-3) [3]: `);
    if (answer === "1") { run("git", ["tag", "-d", tag]); run("git", ["tag", tag]); process.env.FORCE_PUSH = "1"; return; }
    if (answer === "2") {
        const j = JSON.parse(readFileSync("package.json", "utf8")); j.version = `${major}.${minor}.${patch + 1}`;
        writeFileSync("package.json", JSON.stringify(j, null, 2) + "\n", "utf8");
        console.error(`   ✅ Bumped. Run again.`); process.exit(0);
    }
    console.error(`   Aborted.`); process.exit(1);
}

async function main() {
    run("npm", ["run", "build"]);
    run("npm", ["pack", "--dry-run", "--ignore-scripts"]);
    if (dryRun) { console.log(`[dry-run] would commit, tag ${tag}, push, and publish.`); process.exit(0); }

    const filesToAdd = ["-f", "src/", "package.json", "package-lock.json", "README.md", "public/"];
    if (existsSync("LICENSE")) filesToAdd.push("LICENSE");
    if (existsSync("SECURITY.md")) filesToAdd.push("SECURITY.md");
    if (existsSync(".github/")) filesToAdd.push(".github/");
    run("git", ["add", ...filesToAdd]);
    if (hasStagedChanges()) run("git", ["commit", "-m", `Release ${tag}`]);

    await ensureTag();

    const branch = output("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
    const isDetached = branch === "HEAD";
    const needsForce = process.env.FORCE_PUSH === "1";
    const refSpec = isDetached ? "HEAD:main" : "main";

    // Push branch
    let pr = spawnSync("git", ["push", "origin", refSpec].concat(needsForce ? ["--force"] : []), { windowsHide: true, stdio: "inherit" });
    if (pr.status !== 0 && !needsForce) { console.error(`   ⚠️ Retry --force...`); pr = spawnSync("git", ["push", "--force", "origin", refSpec], { windowsHide: true, stdio: "inherit" }); }
    if (pr.status !== 0) process.exit(pr.status ?? 1);

    // Sync local main
    if (isDetached) spawnSync("git", ["checkout", "main"], { windowsHide: true, stdio: "ignore" });

    // Push tag
    let tr = spawnSync("git", ["push", "origin", tag].concat(needsForce ? ["--force"] : []), { windowsHide: true, stdio: "inherit" });
    if (tr.status !== 0 && !needsForce) { console.error(`   ⚠️ Retry --force tag...`); tr = spawnSync("git", ["push", "--force", "origin", tag], { windowsHide: true, stdio: "inherit" }); }
    if (tr.status !== 0) process.exit(tr.status ?? 1);

    // npm publish — use token auth if provided
    const tempNpmrc = publishToken ? `${os.tmpdir()}/.npmrc-publish-${Date.now()}` : null;
    if (publishToken) {
        // Write token to a temporary .npmrc that npm will pick up
        writeFileSync(tempNpmrc, `//registry.npmjs.org/:_authToken=${publishToken}\n`, "utf8");
        process.env.npm_config_userconfig = tempNpmrc;
        console.log("🔑 Using npm token for authentication.");
    }

    const npmArgs = ["publish", "--access", "public"];
    if (otp) npmArgs.push("--otp", otp);
    run("npm", npmArgs);

    // Clean up temporary .npmrc
    if (tempNpmrc) {
        delete process.env.npm_config_userconfig;
        try { rmSync(tempNpmrc); } catch { }
    }

    // Create GitHub Release
    const changes = outputShell(`git log --oneline $(git describe --tags --abbrev=0 ${tag}^ 2>nul || echo HEAD~1)..${tag}^ --format="- %s" 2>nul`);
    const releaseNotes = `## roblox-mcp-difz ${tag}\n\n### Changes since last release:\n${changes || "- Bug fixes and improvements"}`;
    const tmpFile = `${os.tmpdir()}/release-notes-${Date.now()}.md`;
    writeFileSync(tmpFile, releaseNotes, 'utf-8');

    let rr = spawnSync("gh", ["release", "create", tag, "--title", tag, "--notes-file", tmpFile], { windowsHide: true, stdio: "inherit" });
    if (rr.status !== 0) { console.error(`   ⚠️ gh release failed (install gh CLI?): ${rr.stderr?.toString() || ''}`); }
    else console.log(`✅ GitHub Release created: ${tag}`);

    try { rmSync(tmpFile); } catch { }

    console.log(`\n✅ ${tag} pushed to GitHub + released.`);
    console.log(`✅ Published roblox-mcp-difz@${pkg.version} to npm.`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
