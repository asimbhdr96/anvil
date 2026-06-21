import { mkdir, readFile, writeFile, appendFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type {
  EvalResult,
  ResearchReport,
  RunMeta,
  Source,
  StepRecord,
  TraceEvent,
} from './contracts.js';
import { shortId, nowIso } from './utils/json.js';

function runsRoot(): string {
  return process.env.ANVIL_RUNS_DIR ?? path.join(process.cwd(), 'runs');
}

export function getRunDir(runId: string): string {
  return path.join(runsRoot(), runId);
}

export async function createRun(question: string, opts: {
  branches: number;
  depth: 'quick' | 'deep';
  budgetUsd: number;
}): Promise<RunMeta> {
  const id = shortId();
  const dir = getRunDir(id);
  await mkdir(dir, { recursive: true });

  const meta: RunMeta = {
    id,
    question,
    branches: opts.branches,
    depth: opts.depth,
    budgetUsd: opts.budgetUsd,
    spentUsd: 0,
    startedAt: nowIso(),
    status: 'running',
    artifactDir: dir,
  };

  await writeFile(path.join(dir, 'run.json'), JSON.stringify(meta, null, 2));
  await appendTrace(id, { ts: nowIso(), type: 'run.started', meta: { question, ...opts } });
  return meta;
}

export async function appendTrace(runId: string, event: TraceEvent): Promise<void> {
  const line = JSON.stringify(event);
  await appendFile(path.join(getRunDir(runId), 'trace.jsonl'), `${line}\n`, 'utf8');
}

export async function updateRunMeta(runId: string, patch: Partial<RunMeta>): Promise<RunMeta> {
  const file = path.join(getRunDir(runId), 'run.json');
  const meta = JSON.parse(await readFile(file, 'utf8')) as RunMeta;
  const next = { ...meta, ...patch };
  await writeFile(file, JSON.stringify(next, null, 2));
  return next;
}

export async function writeReport(runId: string, report: ResearchReport): Promise<string> {
  const md = renderReportMarkdown(report);
  const file = path.join(getRunDir(runId), 'report.md');
  await writeFile(file, md);
  return file;
}

export async function writeSources(runId: string, sources: Source[]): Promise<void> {
  await writeFile(
    path.join(getRunDir(runId), 'sources.json'),
    JSON.stringify(sources, null, 2),
  );
}

export async function writeEval(runId: string, evalResult: EvalResult): Promise<void> {
  await writeFile(
    path.join(getRunDir(runId), 'eval.json'),
    JSON.stringify(evalResult, null, 2),
  );
}

export function renderReportMarkdown(report: ResearchReport): string {
  const lines: string[] = [
    `# ${report.title}`,
    '',
    '## Recommendation',
    report.recommendation,
    '',
    '## Summary',
    report.summary,
    '',
    '## Tradeoffs',
  ];

  for (const t of report.tradeoffs) {
    lines.push(`### ${t.option}`);
    lines.push('**Pros**');
    for (const p of t.pros) lines.push(`- ${p}`);
    lines.push('**Cons**');
    for (const c of t.cons) lines.push(`- ${c}`);
    lines.push('');
  }

  lines.push('## Sections');
  for (const section of report.sections) {
    lines.push(`### ${section.heading}`);
    lines.push(section.body);
    if (section.claimIds.length) {
      lines.push('');
      lines.push(`_Claims: ${section.claimIds.join(', ')}_`);
    }
    lines.push('');
  }

  if (report.openQuestions.length) {
    lines.push('## Open questions');
    for (const q of report.openQuestions) lines.push(`- ${q}`);
  }

  return lines.join('\n');
}

export async function loadRunMeta(runId: string): Promise<RunMeta> {
  const file = path.join(getRunDir(runId), 'run.json');
  if (!existsSync(file)) {
    throw new Error(`Run not found: ${runId}`);
  }
  return JSON.parse(await readFile(file, 'utf8')) as RunMeta;
}

export async function loadTrace(runId: string): Promise<TraceEvent[]> {
  const file = path.join(getRunDir(runId), 'trace.jsonl');
  if (!existsSync(file)) return [];
  const raw = await readFile(file, 'utf8');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TraceEvent);
}

export async function loadReport(runId: string): Promise<ResearchReport | null> {
  const steps = await getStepRecords(runId);
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (step && (step.agent === 'synthesizer' || step.agent === 'repair')) {
      return step.output as ResearchReport;
    }
  }
  return null;
}

export async function loadEval(runId: string): Promise<EvalResult | null> {
  const file = path.join(getRunDir(runId), 'eval.json');
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, 'utf8')) as EvalResult;
}

export async function getStepRecords(runId: string): Promise<StepRecord[]> {
  const events = await loadTrace(runId);
  const steps: StepRecord[] = [];

  for (const event of events) {
    if (event.type === 'step.completed' && event.step !== undefined && event.agent) {
      steps.push({
        step: event.step,
        agent: event.agent,
        input: event.input,
        output: event.output,
      });
    }
  }

  return steps.sort((a, b) => a.step - b.step);
}

export async function listRuns(): Promise<string[]> {
  const root = runsRoot();
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

export async function resolveRunId(partial: string): Promise<string> {
  if (existsSync(path.join(getRunDir(partial), 'run.json'))) return partial;
  const runs = await listRuns();
  const matches = runs.filter((id) => id.startsWith(partial));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new Error(`Ambiguous run id "${partial}". Matches: ${matches.join(', ')}`);
  }
  throw new Error(`Run not found: ${partial}`);
}

export async function saveStepArtifact(
  runId: string,
  step: number,
  agent: string,
  input: unknown,
  output: unknown,
): Promise<void> {
  await appendTrace(runId, {
    ts: nowIso(),
    type: 'step.completed',
    step,
    agent,
    input,
    output,
  });
}
