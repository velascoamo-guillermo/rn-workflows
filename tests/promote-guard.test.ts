/**
 * I4: never promote a stale commit — but only skip when a later run is
 * guaranteed to re-ship the same leg. Promote requires: ref is the profile
 * branch, sha is an ancestor of origin/<branch>, and no newer commit touches
 * this leg's trigger paths (matrix: matrix.paths; smart: whole repo).
 * Otherwise promote is skipped (staging upload + e2e stay) and the job succeeds.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../src/config/parser';
import { generateGithubActions } from '../src/generators/github-actions';
import { generateMatrixWorkflow } from '../src/generators/github-matrix';
import { getStep, parseWorkflow, runStep, stepRuns, type WorkflowStep } from './helpers/run-step';

const otaAll = loadConfig(resolve(import.meta.dir, 'fixtures', 'ota-e2e-all.yml'));
const smart = generateGithubActions(otaAll, { scheme: 'OtaAll' })[0]!.content;
const matrix = generateMatrixWorkflow([{ dir: 'apps/alpha', slug: 'alpha', config: otaAll, scheme: 'Alpha' }]).content;
const SHARED = 'packages/shared/';
const withShared = { ...otaAll, extraPaths: [SHARED] };
const matrixShared = generateMatrixWorkflow([{ dir: 'apps/alpha', slug: 'alpha', config: withShared, scheme: 'Alpha' }]).content;

const scratch: string[] = [];
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

function commit(work: string, file: string, body: string): string {
  mkdirSync(dirname(join(work, file)), { recursive: true });
  writeFileSync(join(work, file), body);
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', `touch ${file}`);
  git(work, 'push', '-q', '-f', 'origin', 'main');
  return git(work, 'rev-parse', 'HEAD');
}

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
      RNW_SCOPE: step().env?.RNW_SCOPE ?? '',
      ...(c.name.startsWith('matrix') ? { RNW_PATHS: JSON.stringify(['apps/alpha/', SHARED]) } : {}),
      GITHUB_REF: 'refs/heads/main',
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

    test('newer commit touching this leg → promote=false with a notice, step succeeds', async () => {
      const { work, tip } = repo();
      commit(work, c.name.startsWith('matrix') ? 'apps/alpha/src/a.ts' : 'f', '2');
      const r = await runStep(step(), { cwd: work, env: env(tip) });
      expect(r.code).toBe(0);
      expect(r.outputs.promote).toBe('false');
      expect(r.stdout).toContain('::notice::');
    });

    test('non-branch ref (tag push) → promote=false', async () => {
      const { work, tip } = repo();
      const r = await runStep(step(), { cwd: work, env: env(tip, { GITHUB_REF: 'refs/tags/v1.0.0' }) });
      expect(r.code).toBe(0);
      expect(r.outputs.promote).toBe('false');
    });

    test('a different branch (dispatch from a feature branch) → promote=false', async () => {
      const { work, tip } = repo();
      const r = await runStep(step(), { cwd: work, env: env(tip, { GITHUB_REF: 'refs/heads/feature/x' }) });
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

describe('matrix promote guard — trigger-path scope', () => {
  const step = getStep(matrixShared, 'ota', 'fresh');
  const paths = ['apps/alpha/', SHARED, '.github/workflows/rn-release-matrix.yml'];
  const run = async (work: string, sha: string, extra: Record<string, string> = {}, p: string[] = paths) =>
    runStep(step, {
      cwd: work,
      env: {
        RNW_BRANCH: 'main',
        RNW_SCOPE: 'legs',
        RNW_PATHS: JSON.stringify(p),
        GITHUB_REF: 'refs/heads/main',
        GITHUB_SHA: sha,
        ...extra,
      },
    });

  test('shared path reaches the guard via matrix.paths (no ${{ in run)', () => {
    expect(step.env?.RNW_SCOPE).toBe('legs');
    expect(step.env?.RNW_PATHS).toBe('${{ toJSON(matrix.paths) }}');
    expect(step.run).not.toContain('${{');
  });

  test('cross-app: newer commit touches only another app → promote', async () => {
    const { work } = repo();
    const sha = commit(work, 'apps/alpha/a.ts', '1');
    commit(work, 'apps/beta/b.ts', '1');
    const r = await run(work, sha);
    expect(r.code).toBe(0);
    expect(r.outputs.promote).toBe('true');
  });

  test('newer commit touches this app → skip', async () => {
    const { work } = repo();
    const sha = commit(work, 'apps/alpha/a.ts', '1');
    commit(work, 'apps/alpha/z.ts', '1');
    const r = await run(work, sha);
    expect(r.outputs.promote).toBe('false');
    expect(r.stdout).toContain('::notice::');
  });

  test('newer commit touches a shared path → skip', async () => {
    const { work } = repo();
    const sha = commit(work, 'apps/alpha/a.ts', '1');
    commit(work, 'packages/shared/x.ts', '1');
    expect((await run(work, sha)).outputs.promote).toBe('false');
  });

  test('newer commit touches only root docs outside the path set → promote', async () => {
    const { work } = repo();
    const sha = commit(work, 'apps/alpha/a.ts', '1');
    commit(work, 'README.md', '1');
    expect((await run(work, sha)).outputs.promote).toBe('true');
  });

  test('an empty path (app at repo root) means any newer commit skips', async () => {
    const { work } = repo();
    const sha = commit(work, 'a.ts', '1');
    commit(work, 'README.md', '1');
    expect((await run(work, sha, {}, ['', '.github/x.yml'])).outputs.promote).toBe('false');
  });

  test('sha not an ancestor of the tip (rewritten history) → skip', async () => {
    const { work } = repo();
    const sha = commit(work, 'apps/alpha/a.ts', '1');
    git(work, 'reset', '-q', '--hard', 'HEAD~1');
    commit(work, 'apps/beta/b.ts', '1');
    git(work, 'push', '-q', '--force', 'origin', 'main');
    const r = await run(work, sha);
    expect(r.code).toBe(0);
    expect(r.outputs.promote).toBe('false');
  });

  test('tip == sha → promote', async () => {
    const { work } = repo();
    const sha = commit(work, 'apps/alpha/a.ts', '1');
    expect((await run(work, sha)).outputs.promote).toBe('true');
  });

  test('origin has no such branch (exit 2) → skip, success', async () => {
    const { work, tip } = repo();
    const r = await run(work, tip, { RNW_BRANCH: 'release', GITHUB_REF: 'refs/heads/release' });
    expect(r.code).toBe(0);
    expect(r.outputs.promote).toBe('false');
    expect(r.stdout).toContain('no branch release');
  });

  test('paths with spaces, non-ASCII and glob chars are matched literally', async () => {
    const odd = ['apps/my app/', 'apps/ñandú/', 'apps/[x]/'];
    const { work } = repo();
    const sha = commit(work, 'apps/alpha/a.ts', '1');
    // glob chars must not match: apps/x/ is not apps/[x]/
    commit(work, 'apps/x/f.ts', '1');
    expect((await run(work, sha, {}, odd)).outputs.promote).toBe('true');
    for (const dir of odd) {
      const { work: w } = repo();
      const s = commit(w, 'apps/alpha/a.ts', '1');
      commit(w, `${dir}f.ts`, '1');
      const r = await run(w, s, {}, odd);
      expect({ dir, promote: r.outputs.promote }).toEqual({ dir, promote: 'false' });
    }
  });

  test('a shallow checkout is deepened so ancestry and path checks work', async () => {
    const { work } = repo();
    const sha = commit(work, 'apps/alpha/a.ts', '1');
    commit(work, 'apps/beta/b.ts', '1');
    const shallow = join(dirname(work), 'shallow');
    git(dirname(work), 'clone', '-q', '--depth', '1', `file://${join(dirname(work), 'origin.git')}`, shallow);
    const r = await run(shallow, sha);
    expect(r.code).toBe(0);
    expect(r.outputs.promote).toBe('true');
  });
});

describe('direct (no-e2e) production upload guard — ref + ancestry only', () => {
  const otaNoE2e = loadConfig(resolve(import.meta.dir, 'fixtures', 'ota-no-e2e-android.yml'));
  const smartDirect = generateGithubActions(otaNoE2e, { scheme: 'OtaAndroid' })[0]!.content;
  const matrixDirect = generateMatrixWorkflow([{ dir: 'apps/alpha', slug: 'alpha', config: otaNoE2e, scheme: 'Alpha' }]).content;
  const targets = [
    { name: 'smart', content: smartDirect, job: 'ota-android', id: 'fresh-direct', upload: 'upload' },
    { name: 'matrix', content: matrixDirect, job: 'ota', id: 'fresh-direct', upload: 'upload' },
  ];
  for (const t of targets) {
    const step = getStep(t.content, t.job, t.id);
    const env = (sha: string, extra: Record<string, string> = {}): Record<string, string> => ({
      RNW_BRANCH: 'main',
      RNW_SCOPE: step.env?.RNW_SCOPE ?? '',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: sha,
      ...extra,
    });
    test(`${t.name}: upload is gated on the guard and scope is none`, () => {
      expect(step.env?.RNW_SCOPE).toBe('none');
      const up = parseWorkflow(t.content).jobs[t.job]!.steps.find((s) => s.id === t.upload)!;
      expect(String(up.if)).toContain(`steps.${t.id}.outputs.promote == 'true'`);
    });
    test(`${t.name}: tag ref → no upload`, async () => {
      const { work, tip } = repo();
      const r = await runStep(step, { cwd: work, env: env(tip, { GITHUB_REF: 'refs/tags/v1.0.0' }) });
      expect(r.code).toBe(0);
      expect(r.outputs.promote).toBe('false');
    });
    test(`${t.name}: newer unrelated commit does NOT block (no path check)`, async () => {
      const { work, tip } = repo();
      commit(work, 'anything.txt', '1');
      const r = await runStep(step, { cwd: work, env: env(tip) });
      expect(r.outputs.promote).toBe('true');
    });
    test(`${t.name}: non-ancestor sha → no upload`, async () => {
      const { work, tip } = repo();
      const old = commit(work, 'a', '1');
      git(work, 'reset', '-q', '--hard', tip);
      commit(work, 'b', '1');
      git(work, 'push', '-q', '--force', 'origin', 'main');
      const r = await runStep(step, { cwd: work, env: env(old) });
      expect(r.code).toBe(0);
      expect(r.outputs.promote).toBe('false');
    });
  }
});

test('single source: every matrix leg guard path set equals its change-detection path set', () => {
  const plan = parseWorkflow(matrixShared).jobs.plan!;
  const legs = JSON.parse(plan.env!.RELEASE_LEGS!) as Array<{ paths: string[] }>;
  expect(legs.length).toBeGreaterThan(0);
  expect(legs[0]!.paths).toContain(SHARED);
  expect(legs[0]!.paths).toContain('apps/alpha/');
  // both consumers read the same `paths` leg field
  const sel = getStep(matrixShared, 'plan', 'select');
  expect(sel.run).toContain('.paths[]');
  expect(getStep(matrixShared, 'ota', 'fresh').env?.RNW_PATHS).toBe('${{ toJSON(matrix.paths) }}');
  expect(getStep(matrixShared, 'native', 'ota-fresh').env?.RNW_PATHS).toBe('${{ toJSON(matrix.paths) }}');
});
