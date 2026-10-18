import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';

export interface WorkflowStep {
  id?: string;
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}

export interface WorkflowJob {
  name?: string;
  'runs-on'?: unknown;
  needs?: string | string[];
  if?: string;
  env?: Record<string, string>;
  permissions?: Record<string, string>;
  concurrency?: { group: string; 'cancel-in-progress'?: boolean };
  outputs?: Record<string, string>;
  defaults?: { run?: { 'working-directory'?: string } };
  steps: WorkflowStep[];
}

export interface Workflow {
  permissions?: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
}

export function parseWorkflow(content: string): Workflow {
  return yaml.load(content) as Workflow;
}

/** Find a step by job id + step id; throws when absent so tests fail loudly. */
export function getStep(content: string, jobId: string, stepId: string): WorkflowStep {
  const job = parseWorkflow(content).jobs[jobId];
  if (!job) throw new Error(`job ${jobId} not found`);
  const step = job.steps.find((s) => s.id === stepId);
  if (!step?.run) throw new Error(`run step ${stepId} not found in job ${jobId}`);
  return step;
}

export interface RunOptions {
  cwd: string;
  /** Concrete values for the step's `env:` contract (expressions are not evaluated). */
  env?: Record<string, string>;
  /** Directories prepended to PATH (command stubs). */
  pathDirs?: string[];
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  /** Raw GITHUB_OUTPUT file content. */
  rawOutput: string;
  outputs: Record<string, string>;
}

/**
 * Runs a step's `run:` script the way GitHub's default shell does
 * (`bash -e <file>`), with a fresh GITHUB_OUTPUT file. Async so in-process
 * servers (Bun.serve) can answer requests made by the script.
 */
export async function runStep(step: WorkflowStep, opts: RunOptions): Promise<RunResult> {
  const scratch = mkdtempSync(join(tmpdir(), 'rnw-step-'));
  const outputFile = join(scratch, 'github_output');
  const scriptFile = join(scratch, 'step.sh');
  writeFileSync(outputFile, '');
  writeFileSync(scriptFile, step.run ?? '');
  const proc = Bun.spawn(['bash', '-e', scriptFile], {
    cwd: opts.cwd,
    env: {
      PATH: [...(opts.pathDirs ?? []), process.env.PATH ?? ''].join(':'),
      HOME: scratch,
      GITHUB_OUTPUT: outputFile,
      ...opts.env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const rawOutput = readFileSync(outputFile, 'utf8');
  const outputs: Record<string, string> = {};
  for (const line of rawOutput.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) outputs[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return { code, stdout, stderr, rawOutput, outputs };
}
