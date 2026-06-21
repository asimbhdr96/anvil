import { z } from 'zod';

export const SourceSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  snippet: z.string().optional(),
});

export type Source = z.infer<typeof SourceSchema>;

export const RubricItemSchema = z.object({
  id: z.string(),
  criterion: z.string(),
  weight: z.number().min(0).max(1),
});

export const SubQuestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
});

export const BranchPlanSchema = z.object({
  id: z.string(),
  angle: z.string(),
  subQuestionIds: z.array(z.string()),
});

export const SubQuestionSetSchema = z.object({
  question: z.string(),
  subQuestions: z.array(SubQuestionSchema).min(1),
  rubric: z.array(RubricItemSchema).min(1),
  branches: z.array(BranchPlanSchema).min(1),
});

export type SubQuestionSet = z.infer<typeof SubQuestionSetSchema>;

export const ClaimSchema = z.object({
  id: z.string(),
  text: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  subQuestionId: z.string(),
  sources: z.array(SourceSchema),
});

export const ClaimSetSchema = z.object({
  branchId: z.string(),
  claims: z.array(ClaimSchema),
  gaps: z.array(z.string()),
});

export type ClaimSet = z.infer<typeof ClaimSetSchema>;

export const TradeoffSchema = z.object({
  option: z.string(),
  pros: z.array(z.string()),
  cons: z.array(z.string()),
});

export const ReportSectionSchema = z.object({
  heading: z.string(),
  body: z.string(),
  claimIds: z.array(z.string()),
});

export const ResearchReportSchema = z.object({
  title: z.string(),
  recommendation: z.string(),
  summary: z.string(),
  tradeoffs: z.array(TradeoffSchema),
  sections: z.array(ReportSectionSchema).min(1),
  openQuestions: z.array(z.string()),
});

export type ResearchReport = z.infer<typeof ResearchReportSchema>;

export const CriticIssueSchema = z.object({
  severity: z.enum(['blocker', 'warning']),
  message: z.string(),
  rubricId: z.string().optional(),
});

export const CriticResultSchema = z.object({
  passed: z.boolean(),
  issues: z.array(CriticIssueSchema),
  gaps: z.array(z.string()),
});

export type CriticResult = z.infer<typeof CriticResultSchema>;

export const RubricResultSchema = z.object({
  id: z.string(),
  criterion: z.string(),
  passed: z.boolean(),
  notes: z.string(),
});

export const EvalResultSchema = z.object({
  score: z.number().min(0).max(100),
  rubricResults: z.array(RubricResultSchema),
  citationCoverage: z.number().min(0).max(1),
  subQuestionCoverage: z.number().min(0).max(1),
});

export type EvalResult = z.infer<typeof EvalResultSchema>;

/** LLM output — coverage metrics are computed locally, not returned by the model. */
export const ScorerLLMOutputSchema = z.object({
  score: z.coerce.number().min(0).max(100),
  rubricResults: z
    .array(
      z.object({
        id: z.string(),
        criterion: z.string(),
        passed: z.boolean(),
        notes: z.string().optional(),
      }),
    )
    .min(1),
});

export type TraceEventType =
  | 'run.started'
  | 'step.started'
  | 'step.completed'
  | 'step.failed'
  | 'model.call'
  | 'budget.warning'
  | 'budget.exceeded'
  | 'run.completed'
  | 'run.aborted';

export interface TraceEvent {
  ts: string;
  type: TraceEventType;
  step?: number;
  agent?: string;
  input?: unknown;
  output?: unknown;
  meta?: Record<string, unknown>;
}

export interface RunMeta {
  id: string;
  question: string;
  branches: number;
  depth: 'quick' | 'deep';
  budgetUsd: number;
  spentUsd: number;
  score?: number;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'aborted' | 'failed';
  artifactDir: string;
}

export interface RunOptions {
  question: string;
  branches?: number;
  budgetUsd?: number;
  depth?: 'quick' | 'deep';
  signal?: AbortSignal;
}

export interface StepRecord {
  step: number;
  agent: string;
  input: unknown;
  output: unknown;
}
