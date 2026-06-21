import { GoogleGenAI } from '@google/genai';
import type { GenerateContentResponse } from '@google/genai';
import {
  estimateCostUsd,
  type GenerateOptions,
  type GenerateResult,
  type GroundedSource,
  type Provider,
  type UsageStats,
} from './types.js';
import { formatProviderError } from '../errors.js';

const DEFAULT_MODEL = process.env.ANVIL_GEMINI_MODEL ?? 'gemini-2.5-flash';

function extractUsage(response: GenerateContentResponse): UsageStats {
  const meta = response.usageMetadata;
  const promptTokens = meta?.promptTokenCount ?? 0;
  const completionTokens = meta?.candidatesTokenCount ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: meta?.totalTokenCount ?? promptTokens + completionTokens,
  };
}

function extractSources(response: GenerateContentResponse): GroundedSource[] {
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const sources: GroundedSource[] = [];

  for (const chunk of chunks) {
    const web = chunk.web;
    if (web?.uri) {
      sources.push({
        url: web.uri,
        title: web.title ?? undefined,
      });
    }
  }

  const supports = response.candidates?.[0]?.groundingMetadata?.groundingSupports ?? [];
  for (const support of supports) {
    const idx = support.groundingChunkIndices?.[0];
    if (idx === undefined) continue;
    const uri = chunks[idx]?.web?.uri;
    if (!uri) continue;
    const existing = sources.find((s) => s.url === uri);
    if (existing && support.segment?.text) {
      existing.snippet = support.segment.text.slice(0, 280);
    }
  }

  return sources;
}

export class GeminiProvider implements Provider {
  readonly name = 'gemini';
  private readonly client: GoogleGenAI;
  private readonly defaultModel: string;

  constructor(apiKey = process.env.ANVIL_GEMINI_API_KEY, model = DEFAULT_MODEL) {
    if (!apiKey) {
      throw new Error(
        'Missing ANVIL_GEMINI_API_KEY. Copy .env.example to .env and add your Gemini API key.',
      );
    }
    this.client = new GoogleGenAI({ apiKey });
    this.defaultModel = model;
  }

  async generate(prompt: string, options: GenerateOptions = {}): Promise<GenerateResult> {
    const model = options.model ?? this.defaultModel;
    const config: Record<string, unknown> = {
      temperature: options.temperature ?? 0.35,
    };

    if (options.jsonMode) {
      config.responseMimeType = 'application/json';
    }

    if (options.useSearch) {
      config.tools = [{ googleSearch: {} }];
    }

    if (options.systemInstruction) {
      config.systemInstruction = options.systemInstruction;
    }

    try {
      const response = await this.client.models.generateContent({
        model,
        contents: prompt,
        config,
      });

      const text = response.text ?? '';
      if (!text.trim()) {
        throw new Error('Gemini returned an empty response.');
      }

      const usage = extractUsage(response);
      return {
        text,
        usage,
        costUsd: estimateCostUsd(usage),
        sources: extractSources(response),
      };
    } catch (err) {
      throw formatProviderError(err);
    }
  }
}

export { DEFAULT_MODEL };
