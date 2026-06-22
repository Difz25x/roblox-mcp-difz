#!/usr/bin/env node

/**
 * cli.ts — CLI dispatcher for roblox-mcp-difz
 *
 * Commands:
 *   roblox-mcp-difz              → show help
 *   roblox-mcp-difz start        → start HTTP+WS server
 *   roblox-mcp-difz setup        → interactive setup wizard
 *   roblox-mcp-difz setup --ai <name> → auto-setup for specific AI
 */

function printBanner(port: number, toolsCount: number, wsCount: number): void {
    console.log(``);
    console.log(`Roblox MCP Server v1.3.2`);
    console.log(`  HTTP:  http://localhost:${port}/mcp`);
    console.log(`  WS:    ws://localhost:${port}/ws`);
    console.log(`  Info:  http://localhost:${port}/type`);
    console.log(`  Tools: ${toolsCount} registered`);
    console.log(`  Mode:  HTTP + WS`);
    console.log(``);
}

async function cmdStart(): Promise<void> {
    const PORT: number = parseInt(process.env.MCP_PORT as string, 10) || 28429;

    const { createApp } = require('./server-core');
    const { app, server, tools, mcp, wss } = createApp();

    server.listen(PORT, () => {
        printBanner(PORT, tools.count, wss ? wss.connectedCount : 0);
    });
}

async function cmdSetup(targetAI: string | null, transport?: string): Promise<void> {
    const { runSetupWizard } = require('./setup');
    await runSetupWizard(targetAI, transport);
}

function cmdHelp(): void {
    console.log(`
Usage: roblox-mcp-difz [command]

Commands:
  roblox-mcp-difz                       Show this help text
  roblox-mcp-difz start                 Start HTTP + WebSocket server
  roblox-mcp-difz setup                 Interactive setup wizard
  roblox-mcp-difz setup --ai <name>     Setup for a specific AI
  roblox-mcp-difz setup --transport <t>  Transport: http, ws (default: http)
  roblox-mcp-difz setup --ai-list       List supported AI platforms
  roblox-mcp-difz --help                Show this help text

Server info:
  http://localhost:28429/type            Shows all endpoints available
  ws://localhost:28429/ws                WebSocket executor transport

Environment:
  MCP_PORT  HTTP server port (default: 28429)
`);
}

async function main(): Promise<void> {
    const args: string[] = process.argv.slice(2);
    const cmd: string | undefined = args[0];

    if (!cmd) {
        console.log('\n  Roblox MCP — type "roblox-mcp-difz --help" to see available commands.\n');
        cmdHelp();
        return;
    }

    if (cmd === 'start') {
        await cmdStart();
        return;
    }

    if (cmd === 'setup') {
        const aiFlag: number = args.indexOf('--ai');
        const transportFlag: number = args.indexOf('--transport');
        const aiListFlag: boolean = args.includes('--ai-list') || args.includes('-al');
        if (aiListFlag) {
            const setup = require('./setup');
            console.log('\nAvailable AI platforms:\n');
            for (const [key, p] of Object.entries(setup.PLATFORMS)) {
                const plat = p as { icon: string; name: string };
                console.log(`  ${key.padEnd(20)} ${plat.icon} ${plat.name}`);
            }
            console.log('\nAvailable transports: http, ws');
            console.log('Usage: roblox-mcp-difz setup --ai <name> [--transport <type>]\n');
            return;
        }
        const targetAI: string | null = aiFlag !== -1 ? args[aiFlag + 1] : null;
        const transport: string | undefined = transportFlag !== -1 ? args[transportFlag + 1] : undefined;
        await cmdSetup(targetAI, transport);
        return;
    }

    if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
        cmdHelp();
        return;
    }

    console.log(`\n  Unknown: "${cmd}". Use "roblox-mcp-difz --help".\n`);
}

main().catch((err: any) => {
    console.error('[roblox-mcp-difz] Fatal:', err.message);
    process.exit(1);
});

export {};
