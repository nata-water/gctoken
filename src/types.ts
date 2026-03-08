export interface ModelUsage {
  [model: string]: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface PricingInfo {
  inputCostPerMillion: number;
  outputCostPerMillion: number;
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
  sessions: number;
  modelUsage: ModelUsage;
}

export interface MonthlyPoint {
  month: string;
  tokens: number;
  cost: number;
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
