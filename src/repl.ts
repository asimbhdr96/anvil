import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import path from 'node:path';
import chalk from 'chalk';
import { executeRun } from './orchestrator.js';
import { createProgressReporter, printReportFile, type RunProgressReporter } from './render.js';
import { handleRunFailure } from './handle-run-failure.js';
import { RunCancelledError } from './run-cancel.js';
import type { RunOptions } from './contracts.js';
import { getRunDir, listRuns, loadRunMeta, resolveRunId } from './runstore.js';

export interface ReplDefaults {
  branches: number;
  budgetUsd: number;
  depth: 'quick' | 'deep';
}

function printBanner(defaults: ReplDefaults): void {
  console.log('');
  console.log(chalk.bold('Anvil') + chalk.dim(' — agentic research'));
  console.log(chalk.dim('Type a technical question and press Enter. Commands start with /'));
  console.log(
    chalk.dim(
      `  branches ${defaults.branches}  ·  budget $${defaults.budgetUsd.toFixed(2)}  ·  depth ${defaults.depth}`,
    ),
  );
  console.log(chalk.dim('  /help  /runs  /report [id]  /exit  ·  Ctrl+C to quit'));
  console.log('');
}

function printHelp(): void {
  console.log(chalk.bold('Commands'));
  console.log(chalk.dim('  (text)          ') + 'Run research on your question');
  console.log(chalk.dim('  /help           ') + 'Show this help');
  console.log(chalk.dim('  /runs           ') + 'List recent runs');
  console.log(chalk.dim('  /report [id]    ') + 'Print report (last run if id omitted)');
  console.log(chalk.dim('  /exit           ') + 'Quit (also /quit, exit, quit)');
  console.log(chalk.dim('  Ctrl+C          ') + 'Quit immediately');
  console.log('');
}

async function printRuns(): Promise<void> {
  const runs = await listRuns();
  if (!runs.length) {
    console.log(chalk.dim('No runs yet.'));
    return;
  }
  for (const id of runs.slice(-10).reverse()) {
    try {
      const meta = await loadRunMeta(id);
      console.log(
        `${chalk.cyan(id)}  ${chalk.dim(meta.status)}  score=${meta.score ?? '—'}  ${meta.question.slice(0, 55)}`,
      );
    } catch {
      console.log(id);
    }
  }
}

async function printReport(runId: string): Promise<void> {
  const id = await resolveRunId(runId);
  const file = path.join(getRunDir(id), 'report.md');
  await printReportFile(id, file);
}

function isExitCommand(line: string): boolean {
  const cmd = line.trim().toLowerCase();
  return cmd === '/exit' || cmd === '/quit' || cmd === 'exit' || cmd === 'quit';
}

async function handleSlashCommand(line: string, lastRunId: string | null): Promise<string | null | 'exit'> {
  const trimmed = line.trim();
  const [command, ...rest] = trimmed.slice(1).split(/\s+/);
  const arg = rest.join(' ').trim();

  switch (command?.toLowerCase()) {
    case 'help':
      printHelp();
      return lastRunId;
    case 'runs':
      await printRuns();
      return lastRunId;
    case 'report': {
      const id = arg || lastRunId;
      if (!id) {
        console.log(chalk.yellow('No run id. Run a question first or pass /report <id>.'));
        return lastRunId;
      }
      try {
        await printReport(id);
      } catch (err) {
        console.error(chalk.red('Could not load report:'), err instanceof Error ? err.message : err);
      }
      return lastRunId;
    }
    case 'exit':
    case 'quit':
      return 'exit';
    default:
      console.log(chalk.yellow(`Unknown command: /${command}. Type /help.`));
      return lastRunId;
  }
}

export async function startRepl(defaults: ReplDefaults): Promise<void> {
  printBanner(defaults);

  const rl = readline.createInterface({ input, output, terminal: true });

  let lastRunId: string | null = null;
  let activeReporter: RunProgressReporter | null = null;
  let activeAbort: AbortController | null = null;
  let shuttingDown = false;

  const shutdown = (code = 130) => {
    if (shuttingDown) {
      process.exit(code);
    }
    shuttingDown = true;

    activeAbort?.abort();
    activeReporter?.onCancel();

    rl.close();
    process.exit(code);
  };

  rl.on('SIGINT', () => shutdown(130));
  process.on('SIGINT', () => shutdown(130));

  try {
    while (!shuttingDown) {
      let line: string;
      try {
        line = await rl.question(chalk.cyan('› '));
      } catch {
        break;
      }

      const trimmed = line.trim();
      if (!trimmed) continue;
      if (isExitCommand(trimmed)) break;

      if (trimmed.startsWith('/')) {
        const result = await handleSlashCommand(trimmed, lastRunId);
        if (result === 'exit') break;
        lastRunId = result;
        continue;
      }

      console.log('');
      const reporter = createProgressReporter();
      const abort = new AbortController();
      activeReporter = reporter;
      activeAbort = abort;

      try {
        const result = await executeRun(
          {
            question: trimmed,
            branches: defaults.branches,
            budgetUsd: defaults.budgetUsd,
            depth: defaults.depth,
            signal: abort.signal,
          } satisfies RunOptions,
          reporter,
        );
        lastRunId = result.runId;

        if (result.aborted) {
          handleRunFailure(new Error('Run aborted (budget or error). Partial report may be saved.'), reporter, {
            aborted: true,
          });
        }
      } catch (err) {
        if (err instanceof RunCancelledError || abort.signal.aborted) {
          shutdown(130);
        }
        handleRunFailure(err, reporter);
      } finally {
        activeReporter = null;
        activeAbort = null;
      }

      console.log('');
    }
  } finally {
    if (!shuttingDown) {
      rl.close();
      console.log(chalk.dim('Goodbye.'));
    }
  }
}
