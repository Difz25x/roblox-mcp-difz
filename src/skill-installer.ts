import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const HOME = process.env.USERPROFILE || process.env.HOME || '';

export interface SkillTargetDef {
    id: string;
    name: string;
    icon: string;
    type: 'global' | 'project';
    description: string;
    resolvePath: () => string;
    formatContent: (rawSkill: string) => string;
}

/**
 * Returns the canonical source content of the roblox-mcp skill.
 */
export function getSkillContent(): string {
    const candidates = [
        path.resolve(__dirname, '..', 'skills', 'roblox-mcp', 'SKILL.md'),
        path.resolve(__dirname, 'skills', 'roblox-mcp', 'SKILL.md'),
        path.resolve(process.cwd(), 'skills', 'roblox-mcp', 'SKILL.md'),
    ];

    for (const cand of candidates) {
        if (fs.existsSync(cand)) {
            try {
                return fs.readFileSync(cand, 'utf-8');
            } catch {}
        }
    }

    return [
        '---',
        'name: roblox-mcp',
        'description: Master control, automation, reverse engineering, inspection, Luau execution, and telemetry for Roblox clients via the roblox-mcp protocol.',
        '---',
        '# Roblox MCP — Agent Engineering & Mastery Skill',
        '',
        'Use roblox-mcp tools to automate, inspect, and test Roblox games across connected sessions.',
    ].join('\n');
}

export const SKILL_TARGETS: Record<string, SkillTargetDef> = {
    'claude-code-global': {
        id: 'claude-code-global',
        name: 'Claude Code (Global User)',
        icon: '🤖',
        type: 'global',
        description: 'Installs to ~/.claude/skills/roblox-mcp/SKILL.md (available across all Claude sessions)',
        resolvePath: () => path.join(HOME, '.claude', 'skills', 'roblox-mcp', 'SKILL.md'),
        formatContent: (raw) => raw,
    },
    'claude-code-project': {
        id: 'claude-code-project',
        name: 'Claude Code (Current Workspace)',
        icon: '📁',
        type: 'project',
        description: 'Installs to .claude/skills/roblox-mcp/SKILL.md in the current project root',
        resolvePath: () => path.join(process.cwd(), '.claude', 'skills', 'roblox-mcp', 'SKILL.md'),
        formatContent: (raw) => raw,
    },
    'cursor-project': {
        id: 'cursor-project',
        name: 'Cursor IDE (.cursor/rules)',
        icon: '🔷',
        type: 'project',
        description: 'Installs to .cursor/rules/roblox-mcp.mdc for Cursor Composer & Agent',
        resolvePath: () => path.join(process.cwd(), '.cursor', 'rules', 'roblox-mcp.mdc'),
        formatContent: (raw) => {
            if (raw.startsWith('---')) return raw;
            return `---\ndescription: Roblox MCP game automation, reverse engineering, and telemetry rules\nglobs: *\nalwaysApply: false\n---\n\n${raw}`;
        },
    },
    'cursor-global': {
        id: 'cursor-global',
        name: 'Cursor IDE (Global User Rules)',
        icon: '🌐',
        type: 'global',
        description: 'Installs to ~/.cursor/rules/roblox-mcp.mdc',
        resolvePath: () => path.join(HOME, '.cursor', 'rules', 'roblox-mcp.mdc'),
        formatContent: (raw) => {
            if (raw.startsWith('---')) return raw;
            return `---\ndescription: Roblox MCP game automation, reverse engineering, and telemetry rules\nglobs: *\nalwaysApply: false\n---\n\n${raw}`;
        },
    },
    'windsurf-project': {
        id: 'windsurf-project',
        name: 'Windsurf (.windsurf/rules)',
        icon: '🏄',
        type: 'project',
        description: 'Installs to .windsurf/rules/roblox-mcp.md for Windsurf Cascade',
        resolvePath: () => path.join(process.cwd(), '.windsurf', 'rules', 'roblox-mcp.md'),
        formatContent: (raw) => raw,
    },
    'windsurf-global': {
        id: 'windsurf-global',
        name: 'Windsurf (Global User Rules)',
        icon: '🌊',
        type: 'global',
        description: 'Installs to ~/.windsurf/rules/roblox-mcp.md',
        resolvePath: () => path.join(HOME, '.windsurf', 'rules', 'roblox-mcp.md'),
        formatContent: (raw) => raw,
    },
    'copilot-instructions': {
        id: 'copilot-instructions',
        name: 'GitHub Copilot Workspace Instructions',
        icon: '🐙',
        type: 'project',
        description: 'Installs or appends to .github/copilot-instructions.md',
        resolvePath: () => path.join(process.cwd(), '.github', 'copilot-instructions.md'),
        formatContent: (raw) => `\n\n## Roblox MCP Agent Guidelines\n\n${raw}\n`,
    },
};

export interface InstallResult {
    targetId: string;
    name: string;
    success: boolean;
    destinationPath?: string;
    error?: string;
}

/**
 * Installs the roblox-mcp skill to one or more targets.
 */
export function installSkillToTarget(targetId: string): InstallResult {
    const def = SKILL_TARGETS[targetId];
    if (!def) {
        return { targetId, name: targetId, success: false, error: `Unknown skill target: ${targetId}` };
    }

    try {
        const dest = def.resolvePath();
        const dir = path.dirname(dest);
        fs.mkdirSync(dir, { recursive: true });

        const rawContent = getSkillContent();
        const formatted = def.formatContent(rawContent);

        if (targetId === 'copilot-instructions' && fs.existsSync(dest)) {
            const existing = fs.readFileSync(dest, 'utf-8');
            if (!existing.includes('Roblox MCP')) {
                fs.appendFileSync(dest, formatted, 'utf-8');
            }
        } else {
            fs.writeFileSync(dest, formatted, 'utf-8');
        }

        return {
            targetId,
            name: def.name,
            success: true,
            destinationPath: dest,
        };
    } catch (err: any) {
        return {
            targetId,
            name: def.name,
            success: false,
            error: err.message,
        };
    }
}

export function installSkillToTargets(targetIds: string[]): InstallResult[] {
    return targetIds.map(id => installSkillToTarget(id));
}

// ── Interactive CLI Wizard for Skills ──────────────────────────────────

interface SelectItem {
    key: string;
    icon: string;
    name: string;
    description: string;
    checked: boolean;
}

function renderSkillMenu(items: SelectItem[], cursor: number): void {
    console.clear();
    process.stdout.write('\x1b[?25l'); // hide cursor

    const lines: string[] = [];
    lines.push(`  \x1b[1;36mRoblox MCP — AI Skill Installer\x1b[0m`);
    lines.push(`  \x1b[2mInstall dedicated roblox-mcp agent skill to your AI coding tools\x1b[0m`);
    lines.push('');

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const check = item.checked ? '\x1b[32m✔\x1b[0m' : ' ';
        const pointer = i === cursor ? '\x1b[36m❯\x1b[0m' : ' ';
        if (i === cursor) {
            lines.push(`  ${pointer} [${check}] ${item.icon}  \x1b[1m${item.name}\x1b[0m`);
            lines.push(`         \x1b[2m${item.description}\x1b[0m`);
        } else {
            lines.push(`  ${pointer} [${check}] ${item.icon}  \x1b[2m${item.name}\x1b[0m`);
        }
    }

    lines.push('');
    lines.push(`  \x1b[2m↑↓ Navigate  Space Toggle  A Select All  ⏎ Confirm\x1b[0m`);

    for (const line of lines) {
        process.stdout.write('\r\x1b[K' + line + '\n');
    }
}

export async function runSkillInstallerWizard(specificTarget?: string | null): Promise<void> {
    const keys = Object.keys(SKILL_TARGETS);

    if (specificTarget) {
        const target = specificTarget.toLowerCase().trim();
        const matched = keys.find(k => k === target || k.includes(target));
        if (matched) {
            console.log(`\n  \x1b[1;36mInstalling skill to: ${SKILL_TARGETS[matched].name}...\x1b[0m`);
            const res = installSkillToTarget(matched);
            if (res.success) {
                console.log(`  \x1b[32m✔ Successfully installed to:\x1b[0m ${res.destinationPath}\n`);
            } else {
                console.log(`  \x1b[31m✖ Failed:\x1b[0m ${res.error}\n`);
            }
            return;
        }
    }

    const items: SelectItem[] = keys.map(k => ({
        key: k,
        icon: SKILL_TARGETS[k].icon,
        name: SKILL_TARGETS[k].name,
        description: SKILL_TARGETS[k].description,
        checked: k === 'claude-code-global' || k === 'cursor-project', // default recommended
    }));

    let cursor = 0;
    renderSkillMenu(items, cursor);

    if (!process.stdin.isTTY) {
        process.stdout.write('\x1b[?25h');
        const res = installSkillToTargets(['claude-code-global', 'cursor-project']);
        console.log(`Installed ${res.filter(r => r.success).length} skills.`);
        return;
    }

    const selectedKeys = await new Promise<string[]>((resolve) => {
        readline.emitKeypressEvents(process.stdin);
        if (process.stdin.isTTY) process.stdin.setRawMode(true);
        process.stdin.resume();

        const cleanup = () => {
            process.stdout.write('\x1b[?25h');
            if (process.stdin.isTTY) process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeAllListeners('keypress');
        };

        process.stdin.on('keypress', (str: string, key: any) => {
            if (key.ctrl && key.name === 'c') {
                cleanup();
                console.clear();
                resolve([]);
                return;
            }

            if (key.name === 'up' || key.name === 'k') {
                cursor = (cursor - 1 + items.length) % items.length;
                renderSkillMenu(items, cursor);
                return;
            }

            if (key.name === 'down' || key.name === 'j') {
                cursor = (cursor + 1) % items.length;
                renderSkillMenu(items, cursor);
                return;
            }

            if (key.name === 'space' || str === ' ') {
                items[cursor].checked = !items[cursor].checked;
                renderSkillMenu(items, cursor);
                return;
            }

            if (key.name === 'a' || str === 'a' || str === 'A') {
                const allChecked = items.every(i => i.checked);
                for (const item of items) item.checked = !allChecked;
                renderSkillMenu(items, cursor);
                return;
            }

            if (key.name === 'return' || key.name === 'enter') {
                cleanup();
                const chosen = items.filter(i => i.checked).map(i => i.key);
                resolve(chosen);
                return;
            }
        });
    });

    if (selectedKeys.length === 0) {
        console.clear();
        console.log('  \x1b[2mSkill installation cancelled. No targets selected.\x1b[0m\n');
        return;
    }

    console.clear();
    console.log(`  \x1b[1;36mDeploying roblox-mcp skill to ${selectedKeys.length} AI targets...\x1b[0m\n`);

    let successCount = 0;
    for (const key of selectedKeys) {
        const target = SKILL_TARGETS[key];
        process.stdout.write(`  ${target.icon} ${target.name}... `);
        const res = installSkillToTarget(key);
        if (res.success) {
            console.log(`\x1b[32m✔\x1b[0m`);
            console.log(`     \x1b[2mLocation: ${res.destinationPath}\x1b[0m`);
            successCount++;
        } else {
            console.log(`\x1b[31m✖\x1b[0m`);
            console.log(`     \x1b[31mError: ${res.error}\x1b[0m`);
        }
    }

    console.log(`\n  \x1b[1m✔ Complete! ${successCount}/${selectedKeys.length} AI skill configurations updated.\x1b[0m`);
    console.log(`  \x1b[2mYour AI can now seamlessly call all roblox-mcp tools with full contextual mastery.\x1b[0m\n`);
}

module.exports = {
    SKILL_TARGETS,
    getSkillContent,
    installSkillToTarget,
    installSkillToTargets,
    runSkillInstallerWizard,
};
