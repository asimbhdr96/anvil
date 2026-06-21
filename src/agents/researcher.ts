import {
  ClaimSetSchema,
  type ClaimSet,
  type SubQuestionSet,
} from '../contracts.js';
import { callAgent, JSON_RULES, type AgentContext } from './base.js';
import type { GroundedSource } from '../provider/index.js';

type BranchPlan = SubQuestionSet['branches'][number];

export async function runResearcher(
  ctx: AgentContext,
  plan: SubQuestionSet,
  branch: BranchPlan,
): Promise<{ claimSet: ClaimSet; sources: GroundedSource[] }> {
  const subQuestions = plan.subQuestions.filter((sq) =>
    branch.subQuestionIds.includes(sq.id),
  );

  const prompt = `You are a research agent. Use web search to investigate this angle: "${branch.angle}".

Main question: ${plan.question}

Sub-questions to answer:
${subQuestions.map((sq) => `- [${sq.id}] ${sq.text}`).join('\n')}

Return atomic, citable claims. Every claim MUST include at least one source URL from your search.
Mark confidence as high/medium/low. List any gaps you could not resolve.

${JSON_RULES}

Schema:
{
  "branchId": "${branch.id}",
  "claims": [{
    "id": "c1",
    "text": string,
    "confidence": "high"|"medium"|"low",
    "subQuestionId": string,
    "sources": [{ "url": string, "title": string? }]
  }],
  "gaps": [string]
}`;

  const { data, raw } = await callAgent(ctx, 'researcher', prompt, ClaimSetSchema, {
    useSearch: true,
    jsonMode: false,
    temperature: 0.2,
  });

  // Merge grounding sources into claims missing citations
  if (raw.sources.length && data.claims.some((c) => c.sources.length === 0)) {
    for (const claim of data.claims) {
      if (claim.sources.length === 0 && raw.sources[0]) {
        claim.sources.push({ url: raw.sources[0].url, title: raw.sources[0].title });
      }
    }
  }

  return { claimSet: data, sources: raw.sources };
}
