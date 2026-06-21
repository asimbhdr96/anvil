import chalk from 'chalk';
import { executeRun } from './orchestrator.js';
import { createProgressReporter } from './render.js';
import type { RunOptions } from './contracts.js';

export async function runOnce(options: RunOptions): Promise<void> {
  const reporter = createProgressReporter();

  console.log(chalk.bold('Anvil') + chalk.dim(' — agentic research'));
  console.log(chalk.dim('Question: ') + options.question);
  console.log('');

  await executeRun(options, reporter);
}
