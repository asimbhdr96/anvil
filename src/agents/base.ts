import type { Provider, GenerateResult } from '../provider/index.js';
import type { BudgetGovernor } from '../budget.js';
import type { TraceEvent } from '../contracts.js';
import { parseJsonFromText, ValidationError } from '../utils/json.js';
import type { z } from 'zod';

import { assertNotAborted } from '../run-cancel.js';

export interface AgentContext {
  provider: Provider;
  budget: BudgetGovernor;
  signal?: AbortSignal;
  onModelCall?: (event: TraceEvent) => void | Promise<void>;
}

export async function callAgent<T>(
  ctx: AgentContext,
  agent: string,
  prompt: string,
  schema: z.ZodSchema<T>,
  options: {
    useSearch?: boolean;
    jsonMode?: boolean;
    temperature?: number;
    systemInstruction?: string;
  } = {},
): Promise<{ data: T; raw: GenerateResult }> {
  assertNotAborted(ctx.signal);
  ctx.budget.assertWithinBudget();

  const result = await ctx.provider.generate(prompt, {
    useSearch: options.useSearch,
    jsonMode: options.jsonMode ?? true,
    temperature: options.temperature,
    systemInstruction: options.systemInstruction,
  });

  ctx.budget.record(result.costUsd, result.usage);

  await ctx.onModelCall?.({
    ts: new Date().toISOString(),
    type: 'model.call',
    agent,
    meta: {
      costUsd: result.costUsd,
      usage: result.usage,
      sourceCount: result.sources.length,
    },
  });

  ctx.budget.assertWithinBudget();

  try {
    const data = parseJsonFromText(result.text, schema);
    return { data, raw: result };
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw err;
  }
}

export const JSON_RULES = `Return ONLY valid JSON matching the requested schema.
No markdown fences, no commentary, no extra keys.`;
