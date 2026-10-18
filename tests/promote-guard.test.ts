/**
 * I4: never promote a stale commit. Right before promote, the run must be a
 * branch push to the profile branch whose origin tip is still $GITHUB_SHA;
 * otherwise promote is skipped (staging upload + e2e stay) and the job succeeds.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../src/config/parser';
import { generateGithubActions } from '../src/generators/github-actions';
import { generateMatrixWorkflow } from '../src/generators/github-matrix';
import { getStep, parseWorkflow, runStep, stepRuns, type WorkflowStep } from './helpers/run-step';

const otaAll = loadConfig(resolve(import.meta.dir, 'fixtures', 'ota-e2e-all.yml'));
const smart = generateGithubActions(otaAll, { scheme: 'OtaAll' })[0]!.content;
const matrix = generateMatrixWorkflow([{ dir: 'apps/alpha', slug: 'alpha', config: otaAll, scheme: 'Alpha' }]).content;

const scratch: string[] = [];
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** Bare origin with `main`, plus a clone; returns the pushed tip sha. */
function repo(): { work: string; tip: string } {
  const root = mkdtempSync(join(tmpdir(), 'rnw-fresh-'));
  scratch.push(root);
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');
  git(root, 'init', '--bare', '-q', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, work);
  git(work, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(work, 'f'), '1');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'one');
  git(work, 'push', '-q', 'origin', 'main');
  return { work, tip: git(work, 'rev-parse', 'HEAD') };
}

const cases: Array<{ name: string; job: string; stepId: string; promoteId: string; envBranch: Record<string, string> }> = [
  { name: 'smart', job: 'ota-ios', stepId: 'fresh', promoteId: 'promote', envBranch: {} },
  { name: 'smart (native re-check hit)', job: 'native-ios', stepId: 'ota-fresh', promoteId: 'ota-promote', envBranch: {} },
  { name: 'matrix', job: 'ota', stepId: 'fresh', promoteId: 'promote', envBranch: { RNW_BRANCH: 'main' } },
  { name: 'matrix (native re-check hit)', job: 'native', stepId: 'ota-fresh', promoteId: 'ota-promote', envBranch: { RNW_BRANCH: 'main' } },
];

for (const c of cases) {
  describe(`promote freshness guard — ${c.name}`, () => {
    const content = c.name.startsWith('matrix') ? matrix : smart;
    const step = (): WorkflowStep => getStep(content, c.job, c.stepId);
    const env = (sha: string, extra: Record<string, string> = {}): Record<string, string> => ({
      RNW_BRANCH: 'main',
      ...c.envBranch,
      GITHUB_REF_TYPE: 'branch',
      GITHUB_REF_NAME: 'main',
      GITHUB_SHA: sha,
      ...extra,
    });

    test('guard runs before promote and promote is gated on it', () => {
      const steps = parseWorkflow(content).jobs[c.job]!.steps;
      const g = steps.findIndex((s) => s.id === c.stepId);
      const p = steps.findIndex((s) => s.id === c.promoteId);
      expect(g).toBeGreaterThan(-1);
      expect(g).toBeLessThan(p);
      expect(String(steps[p]!.if)).toContain(`steps.${c.stepId}.outputs.promote == 'true'`);
      expect(step().run).not.toContain('${{');
    });

    test('branch tip == GITHUB_SHA → promote=true', async () => {
      const { work, tip } = repo();
      const r = await runStep(step(), { cwd: work, env: env(tip) });
      expect(r.code).toBe(0);
      expect(r.outputs.promote).toBe('true');
    });

    test('branch moved on → promote=false with a notice, step succeeds', async () => {
      const { work, tip } = repo();
      writeFileSync(join(work, 'f'), '2');
      git(work, 'commit', '-q', '-am', 'two');
      git(work, 'push', '-q', 'origin', 'main');
      const r = await runStep(step(), { cwd: work, env: env(tip) });
      expect(r.code).toBe(0);
      expect(r.outputs.promote).toBe('false');
      expect(r.stdout).toContain('::notice::');
    });

    test('non-branch ref (tag push) → promote=false', async () => {
      const { work, tip } = repo();
      const r = await runStep(step(), { cwd: work, env: env(tip, { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.0.0' }) });
      expect(r.code).toBe(0);
      expect(r.outputs.promote).toBe('false');
    });

    test('a different branch (dispatch from a feature branch) → promote=false', async () => {
      const { work, tip } = repo();
      const r = await runStep(step(), { cwd: work, env: env(tip, { GITHUB_REF_NAME: 'feature/x' }) });
      expect(r.code).toBe(0);
      expect(r.outputs.promote).toBe('false');
    });

    test('origin unreachable → step fails (never silently promotes)', async () => {
      const { work, tip } = repo();
      git(work, 'remote', 'set-url', 'origin', join(work, 'missing.git'));
      const r = await runStep(step(), { cwd: work, env: env(tip) });
      expect(r.code).not.toBe(0);
      expect(r.outputs.promote).toBeUndefined();
    });
  });
}

test('smart: guard receives the profile branch via env', () => {
  expect(getStep(smart, 'ota-ios', 'fresh').env?.RNW_BRANCH).toBe('main');
});

test('matrix: guard receives matrix.branch via env and only runs on e2e legs', () => {
  const s = getStep(matrix, 'ota', 'fresh');
  expect(s.env?.RNW_BRANCH).toBe('${{ matrix.branch }}');
  expect(stepRuns(s, { matrix: { e2e: false } })).toBe(false);
  expect(stepRuns(s, { matrix: { e2e: true } })).toBe(true);
});
