export interface ModelUsage {
  [model: string]: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
    cacheWriteTokens?: number;
  };
}

export interface PricingInfo {
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  cachedInputCostPerMillion?: number;
  cacheWriteCostPerMillion?: number;
  displayNames?: string[];
}

export type PricingMap = Record<string, PricingInfo>;

export interface PeriodStats {
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  interactions: number;
  sessions: number;
  estimatedCost: number;
  estimatedAiCredits: number;
  modelUsage: ModelUsage;
}

export interface DailyPoint {
  date: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  interactions: number;
  cost: number;
  aiCredits: number;
  sessions: number;
  modelUsage: ModelUsage;
}

export interface MonthlyPoint {
  month: string;
  tokens: number;
  cost: number;
  aiCredits: number;
  sessions: number;
  interactions: number;
  daysTracked: number;
}

export interface ParsedSession {
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  interactions: number;
  aiCredits: number;
  modelUsage: ModelUsage;
}

export interface UsageResult {
  today: PeriodStats;
  month: PeriodStats;
  last30Days: PeriodStats;
  daily: DailyPoint[];
  monthly: MonthlyPoint[];
  scannedFiles: number;
  lookbackDays: number;
  lastUpdated: string;
  scannedPaths: string[];
}
