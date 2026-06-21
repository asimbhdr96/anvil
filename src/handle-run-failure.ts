import chalk from 'chalk';
import type { RunProgressReporter } from './render.js';
import { formatRunError } from './errors.js';

export function handleRunFailure(
  err: unknown,
  reporter?: RunProgressReporter,
  options: { aborted?: boolean } = {},
): never {
  const message = options.aborted
    ? 'Run aborted before completion.'
    : formatRunError(err);

  reporter?.onFail('Run failed');
  console.error(chalk.red('Run failed:'), message);
  process.exit(1);
}
