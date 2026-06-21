import {
  ScorerLLMOutputSchema,
  type ClaimSet,
  type EvalResult,
  type ResearchReport,
  type SubQuestionSet,
} from '../contracts.js';
import { callAgent, JSON_RULES, type AgentContext } from './base.js';
import { ValidationError } from '../utils/json.js';

export function computeHeuristicEval(
  plan: SubQuestionSet,
  claimSets: ClaimSet[],
  report: ResearchReport,
): Pick<EvalResult, 'citationCoverage' | 'subQuestionCoverage'> {
  const allClaims = claimSets.flatMap((cs) => cs.claims);
  const cited = allClaims.filter((c) => c.sources.length > 0).length;
  const citationCoverage = allClaims.length ? cited / allClaims.length : 0;

  const answeredIds = new Set(allClaims.map((c) => c.subQuestionId));
  const highPriority = plan.subQuestions.filter((sq) => sq.priority === 'high');
  const coveredHigh = highPriority.filter((sq) => answeredIds.has(sq.id)).length;
  const subQuestionCoverage = highPriority.length ? coveredHigh / highPriority.length : 1;

  void report;
  return { citationCoverage, subQuestionCoverage };
}

function buildFallbackEval(
  plan: SubQuestionSet,
  heuristics: Pick<EvalResult, 'citationCoverage' | 'subQuestionCoverage'>,
): EvalResult {
  const rubricResults = plan.rubric.map((item) => ({
    id: item.id,
    criterion: item.criterion,
    passed: heuristics.citationCoverage >= 0.5 && heuristics.subQuestionCoverage >= 0.5,
    notes: 'Heuristic fallback — LLM scorer output was invalid.',
  }));

  const score = Math.round(
    heuristics.citationCoverage * 50 + heuristics.subQuestionCoverage * 50,
  );

  return {
    score: Math.min(100, Math.max(0, score)),
    rubricResults,
    ...heuristics,
  };
}

export async function runScorer(
  ctx: AgentContext,
  plan: SubQuestionSet,
  claimSets: ClaimSet[],
  report: ResearchReport,
): Promise<EvalResult> {
  const heuristics = computeHeuristicEval(plan, claimSets, report);

  const prompt = `You are an eval harness. Score this research run against the rubric (0-100).

Main question: ${plan.question}

Rubric:
${plan.rubric.map((r) => `- [${r.id}] ${r.criterion} (weight ${r.weight})`).join('\n')}

Report (JSON):
${JSON.stringify(report, null, 2)}

Heuristic signals (for your reference only — do NOT include these in your JSON output):
- citation coverage: ${(heuristics.citationCoverage * 100).toFixed(0)}%
- high-priority sub-question coverage: ${(heuristics.subQuestionCoverage * 100).toFixed(0)}%

Return rubricResults with pass/fail per criterion and an overall score.
Do not return citationCoverage or subQuestionCoverage — those are computed separately.

${JSON_RULES}

Schema:
{
  "score": number,
  "rubricResults": [{ "id": string, "criterion": string, "passed": boolean, "notes": string }]
}`;

  try {
    const { data } = await callAgent(ctx, 'scorer', prompt, ScorerLLMOutputSchema, {
      jsonMode: true,
      temperature: 0.1,
    });

    return {
      score: data.score,
      rubricResults: data.rubricResults.map((r) => ({
        id: r.id,
        criterion: r.criterion,
        passed: r.passed,
        notes: r.notes ?? '',
      })),
      citationCoverage: heuristics.citationCoverage,
      subQuestionCoverage: heuristics.subQuestionCoverage,
    };
  } catch (err) {
    if (err instanceof ValidationError) {
      return buildFallbackEval(plan, heuristics);
    }
    throw err;
  }
}

export async function evalExistingReport(
  ctx: AgentContext,
  plan: SubQuestionSet,
  claimSets: ClaimSet[],
  report: ResearchReport,
): Promise<EvalResult> {
  return runScorer(ctx, plan, claimSets, report);
}
