export {
  estimateCostUsd,
  GEMINI_FLASH_INPUT_USD_PER_M,
  GEMINI_FLASH_OUTPUT_USD_PER_M,
} from './types.js';
export type {
  GenerateOptions,
  GenerateResult,
  GroundedSource,
  Provider,
  UsageStats,
} from './types.js';
export { GeminiProvider, DEFAULT_MODEL } from './gemini.js';

import { GeminiProvider } from './gemini.js';
import type { Provider } from './types.js';

export function createProvider(): Provider {
  return new GeminiProvider();
}
