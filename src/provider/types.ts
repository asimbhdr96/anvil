export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface GroundedSource {
  url: string;
  title?: string;
  snippet?: string;
}

export interface GenerateOptions {
  model?: string;
  temperature?: number;
  useSearch?: boolean;
  jsonMode?: boolean;
  systemInstruction?: string;
}

export interface GenerateResult {
  text: string;
  usage: UsageStats;
  costUsd: number;
  sources: GroundedSource[];
}

export interface Provider {
  readonly name: string;
  generate(prompt: string, options?: GenerateOptions): Promise<GenerateResult>;
}

// Approximate Gemini 2.5 Flash pricing (USD per 1M tokens) for budget tracking.
export const GEMINI_FLASH_INPUT_USD_PER_M = 0.075;
export const GEMINI_FLASH_OUTPUT_USD_PER_M = 0.3;

export function estimateCostUsd(usage: UsageStats): number {
  return (
    (usage.promptTokens / 1_000_000) * GEMINI_FLASH_INPUT_USD_PER_M +
    (usage.completionTokens / 1_000_000) * GEMINI_FLASH_OUTPUT_USD_PER_M
  );
}
