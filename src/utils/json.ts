import { z } from 'zod';

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly zodError?: z.ZodError,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function parseJsonFromText<T>(text: string, schema: z.ZodSchema<T>): T {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch?.[1]?.trim() ?? trimmed;
  const jsonMatch = candidate.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new ValidationError('Model response did not contain JSON.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new ValidationError('Model returned invalid JSON.');
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new ValidationError('Model JSON failed schema validation.', result.error);
  }
  return result.data;
}

export function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function dedupeSources<T extends { url: string }>(sources: T[]): T[] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}
