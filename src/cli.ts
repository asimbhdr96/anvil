import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import { replayFromStep } from './orchestrator.js';
import {
  getStepRecords,
  loadRunMeta,
  loadTrace,
  resolveRunId,
} from './runstore.js';
import {
  createProgressReporter,
  printEvalResult,
  printRunDiff,
  printStepInspect,
} from './render.js';
import { createProvider } from './provider/index.js';
import { BudgetGovernor } from './budget.js';
import { evalExistingReport } from './agents/scorer.js';
import type { ClaimSet, ResearchReport, SubQuestionSet } from './contracts.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getRunDir } from './runstore.js';
import { startRepl } from './repl.js';
import { runWithInterrupt } from './run-with-interrupt.js';

const program = new Command();

function parseReplDefaults(opts: { branches: string; budget: string; depth: string }) {
  return {
    branches: Number(opts.branches),
    budgetUsd: Number(opts.budget),
    depth: (opts.depth === 'deep' ? 'deep' : 'quick') as 'quick' | 'deep',
  };
}

function sharedRunOptions(command: Command) {
  return command
    .option('-b, --branches <n>', 'Parallel research branches', '2')
    .option('--budget <usd>', 'Max spend in USD', '0.50')
    .option('-d, --depth <mode>', 'quick or deep', 'quick');
}

program
  .name('anvil')
  .description('Agentic research CLI — typed multi-agent pipelines with replay and eval')
  .version('0.1.0');

const runCmd = program
  .command('run [question]')
  .description('Run a research pipeline (omit question to start interactive mode)')
  .option('--quiet', 'Hide report output in terminal (still saved to runs/)');

sharedRunOptions(runCmd);

runCmd.action(async (question: string | undefined, opts: { branches: string; budget: string; depth: string; quiet?: boolean }) => {
  const defaults = parseReplDefaults(opts);
  if (!question?.trim()) {
    await startRepl(defaults);
    return;
  }

  const reporter = createProgressReporter({ showReport: !opts.quiet });
  await runWithInterrupt(
    {
      question: question.trim(),
      ...defaults,
    },
    reporter,
  );
});

const chatCmd = program
  .command('chat')
  .alias('interactive')
  .description('Start interactive prompt mode (like Gemini / Claude CLI)');

sharedRunOptions(chatCmd);

chatCmd.action(async (opts: { branches: string; budget: string; depth: string }) => {
  await startRepl(parseReplDefaults(opts));
});

program
  .command('report')
  .description('Print a saved report')
  .argument('<runId>', 'Run id (full or prefix)')
  .action(async (runIdArg: string) => {
    const { resolveRunId, getRunDir } = await import('./runstore.js');
    const { printReportFile } = await import('./render.js');
    const runId = await resolveRunId(runIdArg);
    await printReportFile(runId, path.join(getRunDir(runId), 'report.md'));
  });

program
  .command('inspect')
  .description('Inspect a step from a previous run')
  .argument('<runId>', 'Run id (full or prefix)')
  .option('-s, --step <n>', 'Step number')
  .action(async (runIdArg: string, opts: { step?: string }) => {
    const runId = await resolveRunId(runIdArg);
    const meta = await loadRunMeta(runId);
    console.log(chalk.bold(`Run ${runId}`));
    console.log(chalk.dim('Question: ') + meta.question);
    console.log(chalk.dim('Status:   ') + meta.status);
    console.log('');

    if (opts.step) {
      const steps = await getStepRecords(runId);
      const step = steps.find((s) => s.step === Number(opts.step));
      if (!step) {
        console.error(chalk.red(`Step ${opts.step} not found.`));
        process.exit(1);
      }
      printStepInspect(step.step, step.agent, step.input, step.output);
      return;
    }

    const trace = await loadTrace(runId);
    const steps = trace.filter((e) => e.type === 'step.completed');
    for (const event of steps) {
      console.log(
        chalk.dim(`[${event.step}]`) +
          ` ${event.agent}` +
          (event.meta ? chalk.dim(` — ${JSON.stringify(event.meta)}`) : ''),
      );
    }
  });

program
  .command('replay')
  .description('Replay a run from a given step using stored artifacts')
  .argument('<runId>', 'Run id')
  .option('-f, --from <n>', 'Step to replay from (synthesizer step or earlier)', '3')
  .action(async (runIdArg: string, opts: { from: string }) => {
    const runId = await resolveRunId(runIdArg);
    console.log(chalk.bold(`Replaying run ${runId} from step ${opts.from}…`));
    await replayFromStep(runId, Number(opts.from));
    console.log(chalk.green('Replay complete.'));
  });

program
  .command('diff')
  .description('Compare two runs')
  .argument('<runIdA>', 'First run id')
  .argument('<runIdB>', 'Second run id')
  .action(async (a: string, b: string) => {
    const idA = await resolveRunId(a);
    const idB = await resolveRunId(b);
    const metaA = await loadRunMeta(idA);
    const metaB = await loadRunMeta(idB);
    printRunDiff(
      { id: idA, score: metaA.score, question: metaA.question },
      { id: idB, score: metaB.score, question: metaB.question },
    );

    const reportA = await readFile(path.join(getRunDir(idA), 'report.md'), 'utf8').catch(() => null);
    const reportB = await readFile(path.join(getRunDir(idB), 'report.md'), 'utf8').catch(() => null);
    if (reportA && reportB) {
      console.log(chalk.dim(`Report length: ${reportA.length} vs ${reportB.length} chars`));
    }
  });

program
  .command('eval')
  .description('Re-score an existing run')
  .argument('<runId>', 'Run id')
  .action(async (runIdArg: string) => {
    const runId = await resolveRunId(runIdArg);
    const steps = await getStepRecords(runId);
    const planStep = steps.find((s) => s.agent === 'planner');
    const researchStep = steps.find((s) => s.agent === 'researcher');
    const synthStep = [...steps].reverse().find((s) => s.agent === 'synthesizer' || s.agent === 'repair');

    if (!planStep || !researchStep || !synthStep) {
      console.error(chalk.red('Run is missing required steps for eval.'));
      process.exit(1);
    }

    const plan = planStep.output as SubQuestionSet;
    const claimSets = researchStep.output as ClaimSet[];
    const report = synthStep.output as ResearchReport;

    const meta = await loadRunMeta(runId);
    const budget = new BudgetGovernor(meta.budgetUsd);
    const provider = createProvider();

    const evalResult = await evalExistingReport({ provider, budget }, plan, claimSets, report);

    const { writeEval, updateRunMeta } = await import('./runstore.js');
    await writeEval(runId, evalResult);
    await updateRunMeta(runId, { score: evalResult.score });

    printEvalResult(
      evalResult.score,
      evalResult.citationCoverage,
      evalResult.subQuestionCoverage,
    );
  });

program
  .command('runs')
  .description('List recent runs')
  .action(async () => {
    const { listRuns } = await import('./runstore.js');
    const runs = await listRuns();
    if (!runs.length) {
      console.log(chalk.dim('No runs yet.'));
      return;
    }
    for (const id of runs) {
      try {
        const meta = await loadRunMeta(id);
        console.log(
          `${id}  ${chalk.dim(meta.status)}  score=${meta.score ?? '—'}  ${meta.question.slice(0, 60)}`,
        );
      } catch {
        console.log(id);
      }
    }
  });

// Default: `anvil` with no args → interactive mode (Gemini / Claude CLI style)
const args = process.argv.slice(2);

if (args.length === 0) {
  const defaults = {
    branches: Number(process.env.ANVIL_BRANCHES ?? 2),
    budgetUsd: Number(process.env.ANVIL_BUDGET ?? 0.5),
    depth: (process.env.ANVIL_DEPTH === 'deep' ? 'deep' : 'quick') as 'quick' | 'deep',
  };
  await startRepl(defaults);
} else {
  program.parse();
}
