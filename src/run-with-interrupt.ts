import { executeRun, type RunResult } from './orchestrator.js';
import type { RunOptions } from './contracts.js';
import type { RunProgressReporter } from './render.js';
import { RunCancelledError } from './run-cancel.js';
import { handleRunFailure } from './handle-run-failure.js';

export async function runWithInterrupt(
  options: RunOptions,
  reporter: RunProgressReporter,
): Promise<RunResult> {
  const abort = new AbortController();
  let shuttingDown = false;

  const onSigint = () => {
    if (shuttingDown) {
      process.exit(130);
    }
    shuttingDown = true;
    abort.abort();
    reporter.onCancel();
    process.exit(130);
  };

  process.on('SIGINT', onSigint);

  try {
    const result = await executeRun({ ...options, signal: abort.signal }, reporter);
    if (result.aborted) {
      handleRunFailure(new Error('Run aborted before completion.'), reporter, { aborted: true });
    }
    return result;
  } catch (err) {
    if (err instanceof RunCancelledError || abort.signal.aborted) {
      process.exit(130);
    }
    handleRunFailure(err, reporter);
  } finally {
    process.off('SIGINT', onSigint);
  }

  throw new Error('unreachable');
}
