import pLimit from 'p-limit';
import { BudgetExceededError } from './budget.js';
import type { RunOptions, ResearchReport, Source, SubQuestionSet, ClaimSet } from './contracts.js';
import { createProvider } from './provider/index.js';
import { BudgetGovernor } from './budget.js';
import {
  appendTrace,
  createRun,
  saveStepArtifact,
  updateRunMeta,
  writeEval,
  writeReport,
  writeSources,
} from './runstore.js';
import { runPlanner, runResearcher, runSynthesizer, runRepair, runCritic, runScorer } from './agents/index.js';
import { computeHeuristicEval } from './agents/scorer.js';
import type { AgentContext } from './agents/base.js';
import type { EvalResult } from './contracts.js';
import { dedupeSources, nowIso } from './utils/json.js';
import type { RunProgressReporter } from './render.js';
import { assertNotAborted, RunCancelledError } from './run-cancel.js';

const MAX_REPAIR_LOOPS = 2;

export interface RunResult {
  runId: string;
  report: ResearchReport;
  score: number;
  spentUsd: number;
  reportPath: string;
  aborted: boolean;
}

export async function executeRun(
  options: RunOptions,
  reporter?: RunProgressReporter,
): Promise<RunResult> {
  const branches = options.branches ?? 2;
  const budgetUsd = options.budgetUsd ?? 0.5;
  const depth = options.depth ?? 'quick';

  const meta = await createRun(options.question, { branches, depth, budgetUsd });
  const runId = meta.id;
  const budget = new BudgetGovernor(budgetUsd);
  const provider = createProvider();

  let step = 0;
  let plan: SubQuestionSet | null = null;
  let claimSets: ClaimSet[] = [];
  let report: ResearchReport | null = null;

  const ctx: AgentContext = {
    provider,
    budget,
    signal: options.signal,
    onModelCall: async (event) => {
      await appendTrace(runId, event);
      if (budget.isNearLimit()) {
        await appendTrace(runId, {
          ts: nowIso(),
          type: 'budget.warning',
          meta: { spentUsd: budget.getSpentUsd(), budgetUsd },
        });
      }
    },
  };

  try {
    assertNotAborted(options.signal);

    // Step 1: Planner
    step += 1;
    reporter?.onStepStart(step, 'planner', 'Planning research branches…');
    await appendTrace(runId, { ts: nowIso(), type: 'step.started', step, agent: 'planner' });
    plan = await runPlanner(ctx, options.question, branches, depth);
    const activeBranches = plan.branches.slice(0, branches);
    await saveStepArtifact(runId, step, 'planner', { question: options.question }, plan);
    reporter?.onStepComplete(step, 'planner');

    assertNotAborted(options.signal);

    // Step 2: Parallel researchers
    step += 1;
    reporter?.onStepStart(step, 'researcher', `Researching (${activeBranches.length} branches)…`);
    await appendTrace(runId, { ts: nowIso(), type: 'step.started', step, agent: 'researcher' });

    const limit = pLimit(activeBranches.length);
    claimSets = await Promise.all(
      activeBranches.map((branch) =>
        limit(async () => {
          budget.assertWithinBudget();
          return runResearcher(ctx, plan!, branch);
        }),
      ),
    ).then((results) => results.map((r) => r.claimSet));

    await saveStepArtifact(runId, step, 'researcher', { branches: activeBranches }, claimSets);
    reporter?.onStepComplete(step, 'researcher');

    const allSources: Source[] = dedupeSources(
      claimSets.flatMap((cs) => cs.claims.flatMap((c) => c.sources)),
    );
    await writeSources(runId, allSources);

    assertNotAborted(options.signal);

    // Step 3: Synthesizer
    step += 1;
    reporter?.onStepStart(step, 'synthesizer', 'Synthesizing report…');
    await appendTrace(runId, { ts: nowIso(), type: 'step.started', step, agent: 'synthesizer' });
    report = await runSynthesizer(ctx, plan, claimSets);
    await saveStepArtifact(runId, step, 'synthesizer', { plan, claimSets }, report);
    reporter?.onStepComplete(step, 'synthesizer');

    assertNotAborted(options.signal);

    // Step 4: Critic + repair loop
    for (let attempt = 0; attempt <= MAX_REPAIR_LOOPS; attempt += 1) {
      step += 1;
      reporter?.onStepStart(step, 'critic', 'Critiquing report…');
      await appendTrace(runId, { ts: nowIso(), type: 'step.started', step, agent: 'critic' });
      const critic = await runCritic(ctx, plan, claimSets, report);
      await saveStepArtifact(runId, step, 'critic', { report }, critic);
      reporter?.onStepComplete(step, 'critic', critic.passed ? 'passed' : 'issues found');

      if (critic.passed || attempt === MAX_REPAIR_LOOPS) break;

      step += 1;
      const blockers = critic.issues.filter((i) => i.severity === 'blocker').map((i) => i.message);
      reporter?.onStepStart(step, 'repair', `Repairing (${blockers.length} blockers)…`);
      await appendTrace(runId, { ts: nowIso(), type: 'step.started', step, agent: 'repair' });
      report = await runRepair(ctx, plan, report, blockers);
      await saveStepArtifact(runId, step, 'repair', { blockers }, report);
      reporter?.onStepComplete(step, 'repair');
    }

    // Step 5: Scorer
    step += 1;
    reporter?.onStepStart(step, 'scorer', 'Scoring against rubric…');
    await appendTrace(runId, { ts: nowIso(), type: 'step.started', step, agent: 'scorer' });
    let evalResult: EvalResult;
    try {
      evalResult = await runScorer(ctx, plan, claimSets, report);
    } catch (err) {
      const heuristics = computeHeuristicEval(plan, claimSets, report);
      evalResult = {
        score: Math.round((heuristics.citationCoverage + heuristics.subQuestionCoverage) * 50),
        rubricResults: plan.rubric.map((r) => ({
          id: r.id,
          criterion: r.criterion,
          passed: false,
          notes: err instanceof Error ? err.message : 'Scorer failed',
        })),
        ...heuristics,
      };
    }
    await saveStepArtifact(runId, step, 'scorer', { report }, evalResult);
    await writeEval(runId, evalResult);
    reporter?.onStepComplete(step, 'scorer', `score ${evalResult.score}`);

    const reportPath = await writeReport(runId, report);
    const spentUsd = budget.getSpentUsd();

    await updateRunMeta(runId, {
      spentUsd,
      score: evalResult.score,
      completedAt: nowIso(),
      status: 'completed',
    });

    await appendTrace(runId, {
      ts: nowIso(),
      type: 'run.completed',
      meta: { score: evalResult.score, spentUsd },
    });

    await reporter?.onComplete({ runId, score: evalResult.score, spentUsd, reportPath });

    return {
      runId,
      report,
      score: evalResult.score,
      spentUsd,
      reportPath,
      aborted: false,
    };
  } catch (err) {
    const spentUsd = budget.getSpentUsd();
    const cancelled = err instanceof RunCancelledError || options.signal?.aborted;
    const aborted = cancelled || err instanceof BudgetExceededError;

    if (report && plan) {
      await writeReport(runId, report);
    }

    await updateRunMeta(runId, {
      spentUsd,
      completedAt: nowIso(),
      status: aborted ? 'aborted' : 'failed',
    });

    await appendTrace(runId, {
      ts: nowIso(),
      type: cancelled ? 'run.aborted' : aborted ? 'budget.exceeded' : 'run.aborted',
      meta: { error: err instanceof Error ? err.message : String(err), spentUsd },
    });

    if (cancelled) {
      throw err;
    }

    if (report) {
      return {
        runId,
        report,
        score: 0,
        spentUsd,
        reportPath: await writeReport(runId, report),
        aborted: true,
      };
    }

    throw err;
  }
}

export async function replayFromStep(
  runId: string,
  fromStep: number,
): Promise<void> {
  const { getStepRecords, loadRunMeta } = await import('./runstore.js');
  const steps = await getStepRecords(runId);
  const meta = await loadRunMeta(runId);
  const start = steps.find((s) => s.step === fromStep);
  if (!start) {
    throw new Error(`Step ${fromStep} not found in run ${runId}`);
  }

  // Re-run pipeline from synthesizer onward using stored artifacts
  const planStep = steps.find((s) => s.agent === 'planner');
  const researchStep = steps.find((s) => s.agent === 'researcher');
  if (!planStep || !researchStep) {
    throw new Error('Run is missing planner or researcher steps.');
  }

  const plan = planStep.output as SubQuestionSet;
  const claimSets = researchStep.output as ClaimSet[];
  const budget = new BudgetGovernor(meta.budgetUsd);
  const provider = createProvider();
  const ctx: AgentContext = { provider, budget };

  let report = await runSynthesizer(ctx, plan, claimSets);
  if (fromStep <= 3) {
    await saveStepArtifact(runId, fromStep, 'synthesizer', { plan, claimSets }, report);
  }

  const critic = await runCritic(ctx, plan, claimSets, report);
  if (!critic.passed) {
    const blockers = critic.issues.filter((i) => i.severity === 'blocker').map((i) => i.message);
    report = await runRepair(ctx, plan, report, blockers);
  }

  const evalResult = await runScorer(ctx, plan, claimSets, report);
  await writeReport(runId, report);
  await writeEval(runId, evalResult);
  await updateRunMeta(runId, {
    spentUsd: budget.getSpentUsd(),
    score: evalResult.score,
    completedAt: nowIso(),
    status: 'completed',
  });
}
