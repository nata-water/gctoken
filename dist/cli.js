#!/usr/bin/env node
import { scanUsage } from "./scanner.js";
function parseArgs(argv) {
    const opts = {
        days: 30,
        json: false,
        period: "days",
        models: false,
        help: false,
    };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case "--days":
            case "-d": {
                const value = Number(argv[++i]);
                if (!Number.isFinite(value) || value < 1 || value > 365) {
                    process.stderr.write("Error: --days must be 1-365\n");
                    process.exit(1);
                }
                opts.days = Math.floor(value);
                break;
            }
            case "--json":
            case "-j":
                opts.json = true;
                break;
            case "--today":
            case "-t":
                opts.period = "today";
                break;
            case "--month":
            case "-m":
                opts.period = "month";
                break;
            case "--models":
                opts.models = true;
                break;
            case "--help":
            case "-h":
                opts.help = true;
                break;
            default:
                process.stderr.write(`Unknown option: ${arg}\n`);
                process.exit(1);
        }
    }
    return opts;
}
function showHelp() {
    const text = `
gctoken - Estimate GitHub Copilot token usage and costs

Usage:
  npx gctoken [options]

Options:
  -d, --days <N>   Lookback days (default: 30, max: 365)
  -t, --today      Show today's usage only
  -m, --month      Show current month's usage only
  --models         Show per-model breakdown
  -j, --json       Output as JSON
  -h, --help       Show this help

Examples:
  npx gctoken
  npx gctoken --today
  npx gctoken --days 7 --json
  npx gctoken --month --models
`.trimStart();
    process.stdout.write(text);
}
function formatNumber(value) {
    return new Intl.NumberFormat().format(value);
}
function formatCurrency(value) {
    return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: value < 1 ? 4 : 2,
        maximumFractionDigits: value < 1 ? 4 : 2,
    }).format(value);
}
function getPeriodStats(result, period) {
    switch (period) {
        case "today":
            return { label: "Today", stats: result.today };
        case "month":
            return { label: "This month", stats: result.month };
        case "days":
            return {
                label: `Last ${result.lookbackDays} days`,
                stats: result.last30Days,
            };
    }
}
function printText(result, opts) {
    const { label, stats } = getPeriodStats(result, opts.period);
    const lines = [
        `GitHub Copilot Usage (${label})`,
        `${"─".repeat(40)}`,
        `Tokens:       ${formatNumber(stats.tokens).padStart(12)}`,
        `  Input:      ${formatNumber(stats.inputTokens).padStart(12)}`,
        `  Output:     ${formatNumber(stats.outputTokens).padStart(12)}`,
    ];
    if (stats.thinkingTokens > 0) {
        lines.push(`  Thinking:   ${formatNumber(stats.thinkingTokens).padStart(12)}`);
    }
    lines.push(`Interactions: ${formatNumber(stats.interactions).padStart(12)}`, `Sessions:     ${formatNumber(stats.sessions).padStart(12)}`, `Est. Cost:    ${formatCurrency(stats.estimatedCost).padStart(12)}`, `Scanned:      ${formatNumber(result.scannedFiles).padStart(12)} files`);
    if (opts.models && Object.keys(stats.modelUsage).length > 0) {
        lines.push("", "Per-model breakdown:");
        lines.push(`${"  Model".padEnd(32)} ${"Input".padStart(10)} ${"Output".padStart(10)}`);
        lines.push(`  ${"─".repeat(50)}`);
        const sorted = Object.entries(stats.modelUsage).sort(([, a], [, b]) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens));
        for (const [model, usage] of sorted) {
            lines.push(`  ${model.padEnd(30)} ${formatNumber(usage.inputTokens).padStart(10)} ${formatNumber(usage.outputTokens).padStart(10)}`);
        }
    }
    process.stdout.write(lines.join("\n") + "\n");
}
function printJson(result, opts) {
    const { label, stats } = getPeriodStats(result, opts.period);
    const output = {
        period: label,
        tokens: stats.tokens,
        inputTokens: stats.inputTokens,
        outputTokens: stats.outputTokens,
        thinkingTokens: stats.thinkingTokens,
        interactions: stats.interactions,
        sessions: stats.sessions,
        estimatedCostUsd: Number(stats.estimatedCost.toFixed(6)),
        scannedFiles: result.scannedFiles,
        lookbackDays: result.lookbackDays,
        lastUpdated: result.lastUpdated,
    };
    if (opts.models) {
        output.modelUsage = stats.modelUsage;
    }
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}
async function main() {
    const opts = parseArgs(process.argv);
    if (opts.help) {
        showHelp();
        return;
    }
    const result = await scanUsage(opts.days);
    if (opts.json) {
        printJson(result, opts);
    }
    else {
        printText(result, opts);
    }
}
main().catch((error) => {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
});
