import {
  CriticResultSchema,
  type ClaimSet,
  type CriticResult,
  type ResearchReport,
  type SubQuestionSet,
} from '../contracts.js';
import { callAgent, JSON_RULES, type AgentContext } from './base.js';

export async function runCritic(
  ctx: AgentContext,
  plan: SubQuestionSet,
  claimSets: ClaimSet[],
  report: ResearchReport,
): Promise<CriticResult> {
  const prompt = `You are a research critic. Validate the report against the rubric and evidence.

Main question: ${plan.question}

Rubric:
${plan.rubric.map((r) => `- [${r.id}] ${r.criterion}`).join('\n')}

Sub-questions:
${plan.subQuestions.map((sq) => `- [${sq.id}] ${sq.text}`).join('\n')}

Claims (JSON):
${JSON.stringify(claimSets, null, 2)}

Report (JSON):
${JSON.stringify(report, null, 2)}

Rules:
- passed=true only if there are NO blocker issues
- Flag missing citations, unanswered high-priority sub-questions, or unsupported recommendations
- warnings do not fail the run

${JSON_RULES}

Schema:
{
  "passed": boolean,
  "issues": [{ "severity": "blocker"|"warning", "message": string, "rubricId": string? }],
  "gaps": [string]
}`;

  const { data } = await callAgent(ctx, 'critic', prompt, CriticResultSchema, {
    jsonMode: true,
    temperature: 0.1,
  });

  return data;
}
