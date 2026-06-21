import {
  ResearchReportSchema,
  type ClaimSet,
  type ResearchReport,
  type SubQuestionSet,
} from '../contracts.js';
import { callAgent, JSON_RULES, type AgentContext } from './base.js';

export async function runSynthesizer(
  ctx: AgentContext,
  plan: SubQuestionSet,
  claimSets: ClaimSet[],
): Promise<ResearchReport> {
  const claimsJson = JSON.stringify(claimSets, null, 2);

  const prompt = `You are a research synthesizer. Merge parallel research branches into one decision-ready report.

Main question: ${plan.question}

Rubric criteria:
${plan.rubric.map((r) => `- [${r.id}] ${r.criterion} (weight ${r.weight})`).join('\n')}

Research claims (JSON):
${claimsJson}

Write a structured report with a clear recommendation, tradeoffs between options, and sections grounded in claim ids.
Do not invent facts beyond the claims. Note open questions from gaps.

${JSON_RULES}

Schema:
{
  "title": string,
  "recommendation": string,
  "summary": string,
  "tradeoffs": [{ "option": string, "pros": [string], "cons": [string] }],
  "sections": [{ "heading": string, "body": string, "claimIds": [string] }],
  "openQuestions": [string]
}`;

  const { data } = await callAgent(ctx, 'synthesizer', prompt, ResearchReportSchema, {
    jsonMode: true,
    temperature: 0.3,
  });

  return data;
}

export async function runRepair(
  ctx: AgentContext,
  plan: SubQuestionSet,
  report: ResearchReport,
  issues: string[],
): Promise<ResearchReport> {
  const prompt = `You are a repair agent. Fix ONLY the issues listed — do not rewrite unrelated content.

Main question: ${plan.question}

Current report (JSON):
${JSON.stringify(report, null, 2)}

Issues to fix:
${issues.map((i) => `- ${i}`).join('\n')}

Return the corrected report in the same schema. Strengthen weak sections, add missing tradeoffs, and resolve blockers where possible without inventing sources.

${JSON_RULES}`;

  const { data } = await callAgent(ctx, 'repair', prompt, ResearchReportSchema, {
    jsonMode: true,
    temperature: 0.2,
  });

  return data;
}
