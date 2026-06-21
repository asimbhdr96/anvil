import { SubQuestionSetSchema, type SubQuestionSet } from '../contracts.js';
import { callAgent, JSON_RULES, type AgentContext } from './base.js';

export async function runPlanner(
  ctx: AgentContext,
  question: string,
  branchCount: number,
  depth: 'quick' | 'deep',
): Promise<SubQuestionSet> {
  const subQCount = depth === 'deep' ? 5 : 3;
  const prompt = `You are a research planner. Break the user's technical question into sub-questions, a scoring rubric, and ${branchCount} parallel research branches with distinct angles.

Question: ${question}

Produce:
- ${subQCount} sub-questions (mix of high/medium priority)
- 4-6 rubric criteria with weights summing to ~1.0
- exactly ${branchCount} branches, each with a unique angle and assigned sub-question ids

${JSON_RULES}

Schema:
{
  "question": string,
  "subQuestions": [{ "id": "sq1", "text": string, "priority": "high"|"medium"|"low" }],
  "rubric": [{ "id": "r1", "criterion": string, "weight": number }],
  "branches": [{ "id": "b1", "angle": string, "subQuestionIds": ["sq1"] }]
}`;

  const { data } = await callAgent(ctx, 'planner', prompt, SubQuestionSetSchema, {
    jsonMode: true,
    temperature: 0.25,
  });

  return data;
}
