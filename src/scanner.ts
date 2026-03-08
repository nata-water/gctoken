import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parseSessionFileContent } from "./sessionParser.js";
import type {
  DailyPoint,
  ModelUsage,
  MonthlyPoint,
  PeriodStats,
  PricingInfo,
  PricingMap,
  UsageResult,
} from "./types.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadJson(name: string): Record<string, unknown> {
  // In dist/, JSON files sit next to the compiled JS
  const fromDist = join(__dirname, name);
  try {
    return JSON.parse(readFileSync(fromDist, "utf8"));
  } catch {
    // Fallback: src/ layout during development
    const fromSrc = join(__dirname, "..", "src", name);
    return JSON.parse(readFileSync(fromSrc, "utf8"));
  }
}

const modelPricingJson = loadJson("modelPricing.json");
const tokenEstimatorsJson = loadJson("tokenEstimators.json");

const pricing = (modelPricingJson.pricing ?? {}) as PricingMap;
const tokenEstimators = (tokenEstimatorsJson.estimators ?? {}) as Record<
  string,
  number
>;

function estimateTokensFromText(text: string, model = "gpt-4o"): number {
  const normalizedModel = model.toLowerCase();
  let ratio = 0.25;
  for (const [key, value] of Object.entries(tokenEstimators)) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedModel.includes(normalizedKey) ||
      normalizedKey.includes(normalizedModel)
    ) {
      ratio = value;
      break;
    }
  }
  return Math.ceil(text.length * ratio);
}

function getPricingForModel(model: string): PricingInfo | undefined {
  const normalized = model.toLowerCase();
  if (pricing[normalized]) {
    return pricing[normalized];
  }

  for (const [key, info] of Object.entries(pricing)) {
    const normalizedKey = key.toLowerCase();
    if (
      normalized.includes(normalizedKey) ||
      normalizedKey.includes(normalized)
    ) {
      return info;
    }
    if (
      info.displayNames?.some(
        (name) =>
          normalized === name.toLowerCase() ||
          normalized.includes(name.toLowerCase()),
      )
    ) {
      return info;
    }
  }

  return undefined;
}

function calculateEstimatedCost(modelUsage: ModelUsage): number {
  let total = 0;
  for (const [model, usage] of Object.entries(modelUsage)) {
    const info = getPricingForModel(model) ?? pricing["gpt-4o-mini"];
    if (!info) {
      continue;
    }
    total += (usage.inputTokens / 1_000_000) * info.inputCostPerMillion;
    total += (usage.outputTokens / 1_000_000) * info.outputCostPerMillion;
  }
  return total;
}

async function collectWorkspaceChatSessionFiles(
  baseDir: string,
  target: Set<string>,
  cutoffTime: number,
): Promise<void> {
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      await collectFiles(
        path.join(baseDir, entry.name, "chatSessions"),
        target,
        cutoffTime,
        false,
      );
    }
  } catch {
    return;
  }
}

async function collectFiles(
  dirPath: string,
  target: Set<string>,
  cutoffTime: number,
  recursive: boolean,
): Promise<void> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (recursive) {
          await collectFiles(entryPath, target, cutoffTime, true);
        }
        continue;
      }

      if (
        !entry.isFile() ||
        (!entry.name.endsWith(".json") && !entry.name.endsWith(".jsonl"))
      ) {
        continue;
      }

      try {
        const stat = await fs.stat(entryPath);
        if (stat.mtimeMs >= cutoffTime) {
          target.add(entryPath);
        }
      } catch {
        continue;
      }
    }
  } catch {
    return;
  }
}

function getVSCodeUserDataPaths(): string[] {
  const home = os.homedir();
  const platform = process.platform;

  if (platform === "win32") {
    const appData =
      process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return [path.join(appData, "Code", "User")];
  }

  if (platform === "darwin") {
    return [path.join(home, "Library", "Application Support", "Code", "User")];
  }

  // Linux / WSL
  const paths = [path.join(home, ".config", "Code", "User")];

  // VS Code Remote (WSL / SSH): server-side data
  paths.push(path.join(home, ".vscode-server", "data", "User"));

  // WSL: also try to read Windows-side sessions via /mnt/c/
  if (
    process.env.WSL_DISTRO_NAME ||
    process.env.WSLENV ||
    process.platform === "linux"
  ) {
    const winUser = getWindowsUsername();
    if (winUser) {
      const wslWindowsPath = path.join(
        "/mnt/c/Users",
        winUser,
        "AppData/Roaming/Code/User",
      );
      paths.push(wslWindowsPath);
    }
  }

  return paths;
}

function getWindowsUsername(): string {
  // 1. Try USERPROFILE-based detection (set by WSLENV or interop)
  const userProfile = process.env.USERPROFILE;
  if (userProfile) {
    const match = /[/\\]Users[/\\]([^/\\]+)/i.exec(userProfile);
    if (match) {
      return match[1];
    }
  }

  // 2. Try cmd.exe /c to get Windows USERNAME
  try {
    const result = execSync("cmd.exe /c echo %USERNAME%", {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (result && !result.includes("%USERNAME%")) {
      return result;
    }
  } catch {
    // cmd.exe not available or interop disabled
  }

  // 3. Try wslvar
  try {
    const result = execSync("wslvar USERNAME", {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (result) {
      return result;
    }
  } catch {
    // wslvar not installed
  }

  // 4. Scan /mnt/c/Users/ for a profile that has AppData
  try {
    const usersDir = "/mnt/c/Users";
    const { readdirSync, statSync } =
      require("node:fs") as typeof import("node:fs");
    const entries = readdirSync(usersDir);
    for (const entry of entries) {
      if (
        entry === "Public" ||
        entry === "Default" ||
        entry === "Default User" ||
        entry === "All Users"
      ) {
        continue;
      }
      try {
        const appDataPath = path.join(
          usersDir,
          entry,
          "AppData/Roaming/Code/User",
        );
        if (statSync(appDataPath).isDirectory()) {
          return entry;
        }
      } catch {
        continue;
      }
    }
  } catch {
    // /mnt/c/ not mounted
  }

  // 5. Fallback to Linux username
  return process.env.LOGNAME ?? process.env.USER ?? "";
}

async function getCopilotSessionFiles(lookbackDays: number): Promise<string[]> {
  const basePaths = getVSCodeUserDataPaths();
  const candidates = new Set<string>();
  const cutoffTime = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

  for (const basePath of basePaths) {
    await collectWorkspaceChatSessionFiles(
      path.join(basePath, "workspaceStorage"),
      candidates,
      cutoffTime,
    );
    await collectFiles(
      path.join(basePath, "globalStorage", "emptyWindowChatSessions"),
      candidates,
      cutoffTime,
      false,
    );
    await collectFiles(
      path.join(basePath, "globalStorage", "github.copilot-chat"),
      candidates,
      cutoffTime,
      true,
    );
  }

  return Array.from(candidates).sort();
}

function toDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toDateFromKey(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00`);
}

function getStartDateForDays(days: number): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - (days - 1));
  return date;
}

function createEmptyDailyPoint(date: string): DailyPoint {
  return {
    date,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    interactions: 0,
    cost: 0,
    sessions: 0,
    modelUsage: {},
  };
}

function createEmptyPeriodStats(): PeriodStats {
  return {
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    interactions: 0,
    sessions: 0,
    estimatedCost: 0,
    modelUsage: {},
  };
}

function mergeModelUsage(target: ModelUsage, source: ModelUsage): void {
  for (const [model, usage] of Object.entries(source)) {
    if (!target[model]) {
      target[model] = { inputTokens: 0, outputTokens: 0 };
    }
    target[model].inputTokens += usage.inputTokens;
    target[model].outputTokens += usage.outputTokens;
  }
}

function mergePeriodStatsFromDailyPoint(
  target: PeriodStats,
  point: DailyPoint,
): void {
  target.tokens += point.tokens;
  target.inputTokens += point.inputTokens;
  target.outputTokens += point.outputTokens;
  target.thinkingTokens += point.thinkingTokens;
  target.interactions += point.interactions;
  target.sessions += point.sessions;
  target.estimatedCost += point.cost;
  mergeModelUsage(target.modelUsage, point.modelUsage);
}

function buildMonthlyBreakdown(
  dailyMap: Map<string, DailyPoint>,
): MonthlyPoint[] {
  const monthlyMap = new Map<string, MonthlyPoint>();
  for (const point of dailyMap.values()) {
    const month = point.date.slice(0, 7);
    const existing = monthlyMap.get(month) ?? {
      month,
      tokens: 0,
      cost: 0,
      sessions: 0,
      interactions: 0,
      daysTracked: 0,
    };
    existing.tokens += point.tokens;
    existing.cost += point.cost;
    existing.sessions += point.sessions;
    existing.interactions += point.interactions;
    existing.daysTracked += 1;
    monthlyMap.set(month, existing);
  }

  return Array.from(monthlyMap.values()).sort((left, right) =>
    right.month.localeCompare(left.month),
  );
}

export async function scanUsage(lookbackDays: number): Promise<UsageResult> {
  const sessionFiles = await getCopilotSessionFiles(lookbackDays);
  const todayKey = toDayKey(new Date());
  const monthPrefix = todayKey.slice(0, 7);
  const lookbackStart = getStartDateForDays(lookbackDays);
  const dailyMap = new Map<string, DailyPoint>();

  for (const filePath of sessionFiles) {
    let stat: { mtimeMs: number; size: number; mtime: Date };
    try {
      stat = await fs.stat(filePath);
    } catch {
      continue;
    }

    let content: string;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }

    const parsed = parseSessionFileContent(
      filePath,
      content,
      estimateTokensFromText,
    );
    if (parsed.tokens === 0) {
      continue;
    }

    const dateKey = toDayKey(stat.mtime);
    const estimatedCost = calculateEstimatedCost(parsed.modelUsage);

    const existingPoint =
      dailyMap.get(dateKey) ?? createEmptyDailyPoint(dateKey);
    existingPoint.tokens += parsed.tokens;
    existingPoint.inputTokens += parsed.inputTokens;
    existingPoint.outputTokens += parsed.outputTokens;
    existingPoint.thinkingTokens += parsed.thinkingTokens;
    existingPoint.interactions += parsed.interactions;
    existingPoint.cost += estimatedCost;
    existingPoint.sessions += 1;
    mergeModelUsage(existingPoint.modelUsage, parsed.modelUsage);
    dailyMap.set(dateKey, existingPoint);
  }

  const today = createEmptyPeriodStats();
  const month = createEmptyPeriodStats();
  const last30Days = createEmptyPeriodStats();

  for (const point of dailyMap.values()) {
    if (point.date === todayKey) {
      mergePeriodStatsFromDailyPoint(today, point);
    }
    if (point.date.startsWith(monthPrefix)) {
      mergePeriodStatsFromDailyPoint(month, point);
    }
    if (toDateFromKey(point.date).getTime() >= lookbackStart.getTime()) {
      mergePeriodStatsFromDailyPoint(last30Days, point);
    }
  }

  const daily = Array.from(dailyMap.values())
    .filter(
      (point) => toDateFromKey(point.date).getTime() >= lookbackStart.getTime(),
    )
    .sort((left, right) => left.date.localeCompare(right.date));
  const monthly = buildMonthlyBreakdown(dailyMap);

  return {
    today,
    month,
    last30Days,
    daily,
    monthly,
    scannedFiles: sessionFiles.length,
    lookbackDays,
    lastUpdated: new Date().toISOString(),
  };
}
