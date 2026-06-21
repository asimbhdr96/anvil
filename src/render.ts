import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { readFile } from 'node:fs/promises';

export interface RunProgressReporter {
  onStepStart(step: number, agent: string, message: string): void;
  onStepComplete(step: number, agent: string, detail?: string): void;
  onFail(message: string): void;
  onCancel(): void;
  onComplete(result: {
    runId: string;
    score: number;
    spentUsd: number;
    reportPath: string;
  }): void | Promise<void>;
}

export async function printReportMarkdown(runId: string, markdown: string): Promise<void> {
  console.log('');
  console.log(chalk.bold('Report'));
  console.log(chalk.dim(`  run ${runId}`));
  console.log('');
  console.log(markdown.trimEnd());
  console.log('');
}

export async function printReportFile(runId: string, reportPath: string): Promise<void> {
  try {
    const md = await readFile(reportPath, 'utf8');
    await printReportMarkdown(runId, md);
  } catch {
    console.log(chalk.yellow(`Report file not found: ${reportPath}`));
  }
}

export function createProgressReporter(options: { showReport?: boolean } = {}): RunProgressReporter {
  const showReport = options.showReport ?? true;
  let spinner: Ora | null = null;
  let currentStep = 0;

  return {
    onStepStart(step, agent, message) {
      currentStep = step;
      spinner?.stop();
      spinner = ora({
        text: chalk.dim(`[${step}] ${agent}: `) + message,
        color: 'cyan',
      }).start();
    },
    onStepComplete(step, agent, detail) {
      const suffix = detail ? chalk.dim(` — ${detail}`) : '';
      spinner?.succeed(chalk.green(`[${step}] ${agent}`) + suffix);
      spinner = null;
      void currentStep;
    },
    onFail(message) {
      spinner?.fail(chalk.red(message));
      spinner = null;
    },
    onCancel() {
      spinner?.stop();
      spinner = null;
    },
    async onComplete(result) {
      spinner?.stop();
      console.log('');
      console.log(chalk.bold('Run complete'));
      console.log(chalk.dim('  run id   ') + result.runId);
      console.log(chalk.dim('  score    ') + `${result.score}/100`);
      console.log(chalk.dim('  cost     ') + `$${result.spentUsd.toFixed(4)}`);
      console.log(chalk.dim('  report   ') + result.reportPath);

      if (showReport) {
        await printReportFile(result.runId, result.reportPath);
      }

      console.log(chalk.dim(`Inspect: anvil inspect ${result.runId}`));
    },
  };
}

export function printStepInspect(step: number, agent: string, input: unknown, output: unknown): void {
  console.log(chalk.bold(`Step ${step} — ${agent}`));
  console.log(chalk.dim('Input:'));
  console.log(JSON.stringify(input, null, 2));
  console.log(chalk.dim('Output:'));
  console.log(JSON.stringify(output, null, 2));
}

export function printRunDiff(
  a: { id: string; score?: number; question: string },
  b: { id: string; score?: number; question: string },
): void {
  console.log(chalk.bold('Run diff'));
  console.log(`${chalk.dim('A')} ${a.id}  score=${a.score ?? '—'}`);
  console.log(`${chalk.dim('B')} ${b.id}  score=${b.score ?? '—'}`);
  if (a.question !== b.question) {
    console.log(chalk.yellow('Questions differ between runs.'));
  } else {
    const delta =
      a.score !== undefined && b.score !== undefined ? b.score - a.score : null;
    if (delta !== null) {
      const sign = delta >= 0 ? '+' : '';
      console.log(chalk.dim('Score delta: ') + `${sign}${delta}`);
    }
  }
}

export function printEvalResult(score: number, citation: number, subQ: number): void {
  console.log(chalk.bold('Eval result'));
  console.log(chalk.dim('  score              ') + `${score}/100`);
  console.log(chalk.dim('  citation coverage  ') + `${(citation * 100).toFixed(0)}%`);
  console.log(chalk.dim('  sub-Q coverage     ') + `${(subQ * 100).toFixed(0)}%`);
}
