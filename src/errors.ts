import { BudgetExceededError } from './budget.js';

export class GeminiApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'GeminiApiError';
  }
}

function parseRetryAfter(message: string): number | undefined {
  const match = message.match(/retry in ([\d.]+)s/i);
  if (!match?.[1]) return undefined;
  return Math.ceil(Number(match[1]));
}

function parseEmbeddedApiError(message: string): { code?: number; message?: string } | null {
  const jsonStart = message.indexOf('{"error"');
  if (jsonStart === -1) return null;
  try {
    const parsed = JSON.parse(message.slice(jsonStart)) as {
      error?: { code?: number; message?: string };
    };
    return parsed.error ?? null;
  } catch {
    return null;
  }
}

export function formatProviderError(err: unknown, provider = 'Gemini'): Error {
  if (err instanceof GeminiApiError || err instanceof BudgetExceededError) {
    return err;
  }

  const rawMessage = err instanceof Error ? err.message : String(err);
  const embedded = parseEmbeddedApiError(rawMessage);

  const statusCode =
    (err as { status?: number })?.status ??
    embedded?.code ??
    (rawMessage.includes('429') ? 429 : rawMessage.includes('401') ? 401 : 0);

  const apiMessage = embedded?.message ?? rawMessage;
  const retryAfterSec = parseRetryAfter(apiMessage);

  if (statusCode === 429 || apiMessage.toLowerCase().includes('quota')) {
    const hint = retryAfterSec
      ? ` Retry in ~${retryAfterSec}s or check https://ai.google.dev/gemini-api/docs/rate-limits`
      : ' Check https://ai.google.dev/gemini-api/docs/rate-limits';
    return new GeminiApiError(`${provider} API quota exceeded.${hint}`, 429, retryAfterSec);
  }

  if (statusCode === 401 || statusCode === 403 || apiMessage.toLowerCase().includes('api key')) {
    return new GeminiApiError(`${provider} API authentication failed. Check ANVIL_GEMINI_API_KEY.`, statusCode);
  }

  if (err instanceof Error) {
    return err;
  }

  return new Error(rawMessage);
}

export function formatRunError(err: unknown): string {
  const normalized = formatProviderError(err);
  return normalized.message;
}
