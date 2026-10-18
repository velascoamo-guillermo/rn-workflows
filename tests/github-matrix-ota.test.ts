/**
 * #53 — matrix OTA mode: push-triggered change detection, plan-time
 * per-platform fingerprint routing, separate `ota` / `native` matrices.
 *
 * YAML-level assertions on the rendered workflow plus script-level runs of
 * the plan job's `select` / `route` steps against tmp git repos and an
 * inline expo-updates CLI stub.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../src/config/parser';
import type { Config } from '../src/config/schema';
import {
  generateMatrixWorkflow,
  MATRIX_WORKFLOW_FILENAME,
  type MatrixApp,
  type MatrixWorkflowOptions,
} from '../src/generators/github-matrix';
import { e2eCacheKey } from '../src/generators/github-shared';
import { generateGithubActions } from '../src/generators/github-actions';
import { getStep, parseWorkflow, runStep, stepRuns, type IfContext, type WorkflowJob, type WorkflowStep } from './helpers/run-step';

const fixtures = resolve(import.meta.dir, 'fixtures');
const otaAll = loadConfig(join(fixtures, 'ota-e2e-all.yml'));
const otaIosSelfHosted = loadConfig(join(fixtures, 'ota-e2e-ios-selfhosted.yml'));
const otaAndroid = loadConfig(join(fixtures, 'ota-no-e2e-android.yml'));
const plainAndroid = loadConfig(join(fixtures, 'preview-android.yml'));

const ZERO = '0000000000000000000000000000000000000000';

interface Leg {
  app: string;
  dir: string;
  profile: string;
  platform: 'android' | 'ios';
  runsOn: unknown;
  selfHosted: boolean;
  ota: boolean;
  otaServer: string;
  otaChannel: string;
  stagingChannel: string;
  scheme: string;
  e2e: boolean;
  flows: string;
  iosDevice: string;
  tagPrefix: string;
  group: string;
  e2eCachePrefix: string;
  paths: string[];
  branch: string;
  env: string;
  appId: string;
  hash?: string;
}

const monorepo: MatrixApp[] = [
  { dir: 'apps/alpha', slug: 'alpha', config: otaAll, scheme: 'Alpha' },
  { dir: 'apps/beta', slug: 'beta', config: otaAndroid },
  { dir: 'apps/plain', slug: 'plain', config: plainAndroid },
];

function render(apps: MatrixApp[] = monorepo, workflowsPathFromRoot?: string): string {
  const options: MatrixWorkflowOptions = {};
  if (workflowsPathFromRoot) options.workflowsPathFromRoot = workflowsPathFromRoot;
  return generateMatrixWorkflow(apps, options).content;
}

function job(content: string, id: string): WorkflowJob {
  const j = parseWorkflow(content).jobs[id];
  if (!j) throw new Error(`job ${id} missing`);
  return j;
}

function legs(content: string): Leg[] {
  return JSON.parse(job(content, 'plan').env!['RELEASE_LEGS']!) as Leg[];
}

const scratch: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rnw-matrix-ota-'));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function commitFile(repo: string, path: string, body = 'x'): string {
  mkdirSync(join(repo, path, '..'), { recursive: true });
  writeFileSync(join(repo, path), `${body}\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', `touch ${path}`);
  return git(repo, 'rev-parse', 'HEAD');
}

// ---------------------------------------------------------------------------
// YAML shape
// ---------------------------------------------------------------------------

describe('OTA mode workflow shape', () => {
  const content = render();
  const parsed = parseWorkflow(content) as ReturnType<typeof parseWorkflow> & {
    on: { push?: { branches?: string[]; tags?: string[] }; workflow_dispatch?: { inputs?: Record<string, unknown> } };
  };

  test('push-triggered on the ota profiles branches, keeps tag push + dispatch app filter', () => {
    expect(parsed.on.push?.branches).toEqual(['main']);
    expect(parsed.on.push?.tags).toEqual(['v*']);
    expect(parsed.on.workflow_dispatch?.inputs?.['app']).toBeDefined();
  });

  test('workflow token is read-only; only the native job may write (tags)', () => {
    expect(parsed.permissions).toEqual({ contents: 'read' });
    expect(job(content, 'native').permissions).toEqual({ contents: 'write' });
    expect(job(content, 'ota').permissions).toBeUndefined();
  });

  test('plan checks out full history and exposes ota / native / quality', () => {
    const plan = job(content, 'plan');
    const checkout = plan.steps.find((s) => s.uses?.startsWith('actions/checkout'));
    expect(checkout?.with?.['fetch-depth']).toBe(0);
    expect(Object.keys(plan.outputs ?? {}).sort()).toEqual(['native', 'ota', 'quality']);
    expect(plan.outputs!['ota']).toContain('steps.route.outputs.ota');
    expect(plan.outputs!['native']).toContain('steps.route.outputs.native');
    expect(plan.outputs!['quality']).toContain('steps.select.outputs.quality');
    const select = getStep(content, 'plan', 'select');
    expect(select.env?.['RNW_BEFORE']).toBe('${{ github.event.before }}');
  });

  test('no release job in OTA mode; ota and native consume their own matrices', () => {
    expect(parseWorkflow(content).jobs['release']).toBeUndefined();
    const ota = job(content, 'ota') as WorkflowJob & { strategy?: { matrix?: { include?: string } } };
    const native = job(content, 'native') as WorkflowJob & { strategy?: { matrix?: { include?: string } } };
    expect(ota.strategy?.matrix?.include).toBe('${{ fromJSON(needs.plan.outputs.ota) }}');
    expect(native.strategy?.matrix?.include).toBe('${{ fromJSON(needs.plan.outputs.native) }}');
    for (const j of [ota, native]) {
      expect(j.needs).toEqual(['plan', 'quality']);
      expect(j['runs-on']).toBe('${{ matrix.runsOn }}');
      expect(j.defaults?.run?.['working-directory']).toBe('${{ matrix.dir }}');
    }
    expect(ota.if).toContain("needs.plan.outputs.ota != '[]'");
    expect(native.if).toContain("needs.plan.outputs.native != '[]'");
  });

  test('ota and native legs share the per-leg concurrency group, never cancelled', () => {
    for (const id of ['ota', 'native']) {
      expect(job(content, id).concurrency).toEqual({ group: '${{ matrix.group }}', 'cancel-in-progress': false });
    }
  });

  test('native matrix runs one leg at a time when an iOS leg uses match', () => {
    const native = job(content, 'native') as WorkflowJob & { strategy?: { 'max-parallel'?: number } };
    expect(native.strategy?.['max-parallel']).toBe(1);
  });

  test('android-only monorepo keeps native legs parallel', () => {
    const android = render([
      { dir: 'apps/beta', slug: 'beta', config: otaAndroid },
      { dir: 'apps/plain', slug: 'plain', config: plainAndroid },
    ]);
    const native = job(android, 'native') as WorkflowJob & { strategy?: { 'max-parallel'?: number } };
    expect(native.strategy?.['max-parallel']).toBeUndefined();
  });

  test('ota job exports + uploads per platform for the routed hash (no universal bundle)', () => {
    expect(content).not.toContain('--platform all');
    expect(content).not.toContain('otaUpload');
    const exp = getStep(content, 'ota', 'export');
    expect(exp.env?.['RNW_PLATFORM']).toBe('${{ matrix.platform }}');
    const upload = getStep(content, 'ota', 'upload');
    expect(upload.env?.['RNW_HASH']).toBe('${{ matrix.hash }}');
    expect(upload.env?.['RNW_OTA_SERVER']).toBe('${{ matrix.otaServer }}');
    expect(upload.env?.['RNW_CHANNEL']).toBe('${{ matrix.otaChannel }}');
    expect(upload.env?.['OTA_UPLOAD_KEY']).toBe('${{ secrets.OTA_UPLOAD_KEY }}');
  });

  test('native job: pins the override, re-checks the tag, runs fastlane via env, tags after', () => {
    const native = job(content, 'native');
    const ids = native.steps.map((s) => s.id ?? s.name ?? '');
    const pin = native.steps.find((s) => s.id === 'pin-runtime')!;
    expect(String(pin.if)).toContain('matrix.ota');
    expect(pin.env?.['RNW_HASH']).toBe('${{ matrix.hash }}');
    expect(pin.run).toContain('EXPO_UPDATES_FINGERPRINT_OVERRIDE=');
    const fastlane = native.steps.find((s) => s.id === 'fastlane')!;
    expect(fastlane.run).toBe('bundle exec fastlane "$RNW_PLATFORM" "$RNW_PROFILE"');
    expect(fastlane.env?.['RNW_PLATFORM']).toBe('${{ matrix.platform }}');
    expect(fastlane.env?.['RNW_PROFILE']).toBe('${{ matrix.profile }}');
    expect(fastlane.env?.['MATCH_PASSWORD']).toBe('${{ secrets.MATCH_PASSWORD }}');
    expect(String(fastlane.if)).toContain("steps.recheck.outputs.exists != 'true'");
    const recheck = native.steps.find((s) => s.id === 'recheck')!;
    expect(String(recheck.if)).toContain('matrix.ota');
    expect(recheck.env?.['RNW_TAG_PREFIX']).toBe('${{ matrix.tagPrefix }}');
    const tag = native.steps.find((s) => s.id === 'tag')!;
    expect(String(tag.if)).toContain('matrix.ota');
    expect(String(tag.if)).toContain("steps.recheck.outputs.exists != 'true'");
    expect(ids.indexOf('recheck')).toBeLessThan(ids.indexOf('fastlane'));
    expect(ids.indexOf('fastlane')).toBeLessThan(ids.indexOf('tag'));
  });

  test('no ${{ inside any run: (every value via env)', () => {
    const variants = [
      content,
      render([{ dir: 'apps/solo', slug: 'solo', config: otaIosSelfHosted }]),
      render([{ dir: '', slug: 'root', config: otaAll }]),
    ];
    for (const v of variants) {
      for (const [id, j] of Object.entries(parseWorkflow(v).jobs)) {
        for (const s of j.steps) {
          if (s.run?.includes('${{')) throw new Error(`\${{ in run: of ${id}/${s.id ?? s.name}`);
        }
      }
    }
  });

  test('ota + native jobs first write the leg ci.env to GITHUB_ENV (after checkout)', async () => {
    for (const id of ['ota', 'native']) {
      const steps = job(content, id).steps;
      expect(steps[0]!.uses).toStartWith('actions/checkout');
      expect(steps[1]!.id).toBe('ci-env');
      expect(steps[1]!.env?.['RNW_CI_ENV']).toBe('${{ matrix.env }}');
    }
    const dir = tmp();
    const envFile = join(dir, 'github_env');
    writeFileSync(envFile, '');
    const r = await runStep(getStep(content, 'ota', 'ci-env'), {
      cwd: dir,
      env: { GITHUB_ENV: envFile, RNW_CI_ENV: '{"SENTRY_DISABLE_AUTO_UPLOAD":"true","API_URL":"https://api.x.dev/v1"}' },
    });
    expect(r.code).toBe(0);
    expect(readFileSync(envFile, 'utf8')).toBe('SENTRY_DISABLE_AUTO_UPLOAD=true\nAPI_URL=https://api.x.dev/v1\n');
  });

  test('legs carry ci.env as a JSON string', () => {
    const solo = legs(render([{ dir: 'apps/solo', slug: 'solo', config: otaIosSelfHosted }]));
    expect(JSON.parse(solo[0]!.env)).toEqual({ SENTRY_DISABLE_AUTO_UPLOAD: 'true' });
    expect(JSON.parse(legs(content)[0]!.env)).toEqual({});
  });
});

describe('OTA mode legs', () => {
  const all = legs(render());

  test('one leg per app × profile × platform with routing metadata', () => {
    expect(all.map((l) => `${l.app}/${l.profile}/${l.platform}`)).toEqual([
      'alpha/production/android',
      'alpha/production/ios',
      'beta/production/android',
      'plain/preview/android',
    ]);
    const ios = all.find((l) => l.app === 'alpha' && l.platform === 'ios')!;
    expect(ios).toMatchObject({
      dir: 'apps/alpha',
      ota: true,
      otaServer: 'https://ota.example.com',
      otaChannel: 'production',
      stagingChannel: 'staging',
      scheme: 'Alpha',
      e2e: true,
      flows: '.maestro',
      iosDevice: '',
      tagPrefix: 'rnw/native/alpha/production/ios',
      group: 'rnw-alpha-production-ios',
      branch: 'main',
      paths: ['apps/alpha/', `.github/workflows/${MATRIX_WORKFLOW_FILENAME}`],
    });
    expect(`${ios.e2eCachePrefix}H`).toBe(
      e2eCacheKey({ appSlug: 'alpha', profile: 'production', platform: 'ios' }, 'staging', 'H'),
    );
    expect('otaUpload' in ios).toBe(false);
  });

  test('scheme falls back to the bundle id tail when undetected; iosDevice carried', () => {
    const solo = legs(render([{ dir: 'apps/solo', slug: 'solo', config: otaIosSelfHosted }]))[0]!;
    expect(solo.scheme).toBe('selfhosted');
    expect(solo.iosDevice).toBe('iPhone 16 Pro Max');
    expect(solo.selfHosted).toBe(true);
  });

  test('non-e2e and non-ota legs carry empty e2e fields', () => {
    const beta = all.find((l) => l.app === 'beta')!;
    expect(beta).toMatchObject({ ota: true, e2e: false, flows: '', e2eCachePrefix: '' });
    const plain = all.find((l) => l.app === 'plain')!;
    expect(plain).toMatchObject({ ota: false, e2e: false, otaServer: '', tagPrefix: 'rnw/native/plain/preview/android' });
    expect(plain.branch).toBe('develop');
  });

  test('extraPaths globs become path prefixes; root app matches everything', () => {
    const shared: Config = { ...otaAndroid, extraPaths: ['packages/kit/**', 'tsconfig.base.json'] };
    const [leg] = legs(render([{ dir: '', slug: 'root', config: shared }], 'ci/workflows'));
    expect(leg!.paths).toEqual(['', 'packages/kit/', 'tsconfig.base.json', `ci/workflows/${MATRIX_WORKFLOW_FILENAME}`]);
  });

  test('iOS-only monorepo has no android legs, jobs or steps', () => {
    const content = render([{ dir: 'apps/solo', slug: 'solo', config: otaIosSelfHosted }]);
    expect(legs(content).every((l) => l.platform === 'ios')).toBe(true);
    expect(content.toLowerCase()).not.toContain('android');
    expect(content).not.toContain('setup-java');
  });
});

// ---------------------------------------------------------------------------
// plan/select: change detection
// ---------------------------------------------------------------------------

describe('plan select step (change detection)', () => {
  const sharedAlpha: Config = { ...otaAll, extraPaths: ['packages/**'] };
  const sharedBeta: Config = { ...otaAndroid, extraPaths: ['packages/**'] };
  const content = render([
    { dir: 'apps/alpha', slug: 'alpha', config: sharedAlpha },
    { dir: 'apps/beta', slug: 'beta', config: sharedBeta },
    { dir: 'apps/plain', slug: 'plain', config: plainAndroid },
  ]);
  const plan = job(content, 'plan');
  const select = getStep(content, 'plan', 'select');

  function repo(): { dir: string; base: string } {
    const dir = tmp();
    git(dir, 'init', '-q');
    const base = commitFile(dir, 'README.md');
    return { dir, base };
  }

  async function runSelect(cwd: string, env: Record<string, string>) {
    const r = await runStep(select, {
      cwd,
      env: {
        RELEASE_LEGS: plan.env!['RELEASE_LEGS']!,
        QUALITY_LEGS: plan.env!['QUALITY_LEGS']!,
        APP_FILTER: '',
        RNW_BEFORE: '',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REF_TYPE: 'branch',
        GITHUB_REF_NAME: 'main',
        GITHUB_SHA: git(cwd, 'rev-parse', 'HEAD'),
        ...env,
      },
    });
    if (r.code !== 0) throw new Error(`select failed: ${r.stderr}`);
    const selected = JSON.parse(r.outputs['selected']!) as Leg[];
    return { r, keys: selected.map((l) => `${l.app}/${l.platform}`), quality: JSON.parse(r.outputs['quality']!) as Array<{ app: string }> };
  }

  test('push selects only the ota legs whose app dir changed', async () => {
    const { dir, base } = repo();
    commitFile(dir, 'apps/beta/src/index.ts');
    const { keys, r } = await runSelect(dir, { RNW_BEFORE: base });
    expect(keys).toEqual(['beta/android']);
    expect(r.outputs['has_ota']).toBe('true');
  });

  test('a non-ASCII filename under an app dir selects that app', async () => {
    const { dir, base } = repo();
    commitFile(dir, 'apps/beta/assets/caf\u00e9-\u00f1and\u00fa.png');
    expect((await runSelect(dir, { RNW_BEFORE: base })).keys).toEqual(['beta/android']);
  });

  test('a rename across apps selects both the source and the destination app', async () => {
    const { dir } = repo();
    commitFile(dir, 'apps/alpha/src/shared.ts', 'export const a = 1;\nexport const b = 2;\nexport const c = 3;');
    const before = git(dir, 'rev-parse', 'HEAD');
    mkdirSync(join(dir, 'apps', 'beta', 'src'), { recursive: true });
    git(dir, 'mv', 'apps/alpha/src/shared.ts', 'apps/beta/src/shared.ts');
    git(dir, 'commit', '-q', '-m', 'move');
    const { keys } = await runSelect(dir, { RNW_BEFORE: before });
    expect(keys).toEqual(['alpha/android', 'alpha/ios', 'beta/android']);
  });

  test('app dir prefixes do not leak into sibling dirs sharing a name prefix', async () => {
    const { dir, base } = repo();
    commitFile(dir, 'apps/betamax/index.ts');
    commitFile(dir, 'apps/alpha-old/index.ts');
    expect((await runSelect(dir, { RNW_BEFORE: base })).keys).toEqual([]);
  });

  test('apps/foo and apps/foobar: a change in one never selects the other (M-9)', async () => {
    const pair = render([
      { dir: 'apps/foo', slug: 'foo', config: otaAndroid },
      { dir: 'apps/foobar', slug: 'foobar', config: otaAndroid },
    ]);
    const pairPlan = job(pair, 'plan');
    const pairSelect = getStep(pair, 'plan', 'select');
    const run = async (file: string): Promise<string[]> => {
      const { dir, base } = repo();
      commitFile(dir, file);
      const r = await runStep(pairSelect, {
        cwd: dir,
        env: {
          RELEASE_LEGS: pairPlan.env!['RELEASE_LEGS']!,
          QUALITY_LEGS: pairPlan.env!['QUALITY_LEGS']!,
          APP_FILTER: '',
          RNW_BEFORE: base,
          GITHUB_EVENT_NAME: 'push',
          GITHUB_REF_TYPE: 'branch',
          GITHUB_REF_NAME: 'main',
          GITHUB_SHA: git(dir, 'rev-parse', 'HEAD'),
        },
      });
      expect(r.code).toBe(0);
      return (JSON.parse(r.outputs['selected']!) as Leg[]).map((l) => l.app);
    };
    expect(await run('apps/foobar/src/index.ts')).toEqual(['foobar']);
    expect(await run('apps/foo/src/index.ts')).toEqual(['foo']);
  });

  test('a change under a shared extraPath selects every app that declares it', async () => {
    const { dir, base } = repo();
    commitFile(dir, 'packages/kit/index.ts');
    const { keys } = await runSelect(dir, { RNW_BEFORE: base });
    expect(keys).toEqual(['alpha/android', 'alpha/ios', 'beta/android']);
  });

  test('a change to the workflow file itself selects every ota leg', async () => {
    const { dir, base } = repo();
    commitFile(dir, `.github/workflows/${MATRIX_WORKFLOW_FILENAME}`);
    const { keys } = await runSelect(dir, { RNW_BEFORE: base });
    expect(keys).toEqual(['alpha/android', 'alpha/ios', 'beta/android']);
  });

  test('unrelated change selects nothing', async () => {
    const { dir, base } = repo();
    commitFile(dir, 'docs/notes.md');
    const { keys, quality, r } = await runSelect(dir, { RNW_BEFORE: base });
    expect(keys).toEqual([]);
    expect(quality).toEqual([]);
    expect(r.outputs['has_ota']).toBe('false');
  });

  test('zero BEFORE (new branch) selects every ota leg on the branch', async () => {
    const { dir } = repo();
    const { keys } = await runSelect(dir, { RNW_BEFORE: ZERO });
    expect(keys).toEqual(['alpha/android', 'alpha/ios', 'beta/android']);
  });

  test('unreachable BEFORE (force push) selects every ota leg on the branch', async () => {
    const { dir } = repo();
    const { keys } = await runSelect(dir, { RNW_BEFORE: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' });
    expect(keys).toEqual(['alpha/android', 'alpha/ios', 'beta/android']);
  });

  test('push never selects non-ota legs, even when their dir changed', async () => {
    const { dir, base } = repo();
    commitFile(dir, 'apps/plain/src/index.ts');
    expect((await runSelect(dir, { RNW_BEFORE: base })).keys).toEqual([]);
    expect((await runSelect(dir, { RNW_BEFORE: ZERO, GITHUB_REF_NAME: 'develop' })).keys).toEqual([]);
  });

  test('push to a branch no ota profile releases from selects nothing', async () => {
    const { dir, base } = repo();
    commitFile(dir, 'apps/alpha/src/index.ts');
    expect((await runSelect(dir, { RNW_BEFORE: base, GITHUB_REF_NAME: 'feature/x' })).keys).toEqual([]);
  });

  test('quality legs follow the selected apps', async () => {
    const withChecks = render([
      { dir: 'apps/alpha', slug: 'alpha', config: { ...otaAll, checks: { test: true } } },
      { dir: 'apps/beta', slug: 'beta', config: { ...otaAndroid, checks: { lint: true } } },
    ]);
    const p = job(withChecks, 'plan');
    const { dir, base } = repo();
    commitFile(dir, 'apps/beta/x.ts');
    const r = await runStep(getStep(withChecks, 'plan', 'select'), {
      cwd: dir,
      env: {
        RELEASE_LEGS: p.env!['RELEASE_LEGS']!,
        QUALITY_LEGS: p.env!['QUALITY_LEGS']!,
        APP_FILTER: '',
        RNW_BEFORE: base,
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REF_TYPE: 'branch',
        GITHUB_REF_NAME: 'main',
        GITHUB_SHA: git(dir, 'rev-parse', 'HEAD'),
      },
    });
    expect(r.code).toBe(0);
    expect((JSON.parse(r.outputs['quality']!) as Array<{ app: string }>).map((q) => q.app)).toEqual(['beta']);
  });

  test('tag push selects every leg, ota or not', async () => {
    const { dir } = repo();
    const { keys } = await runSelect(dir, { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.0.0' });
    expect(keys).toEqual(['alpha/android', 'alpha/ios', 'beta/android', 'plain/android']);
  });

  test('dispatch filters by app (non-ota included); empty filter selects all', async () => {
    const { dir } = repo();
    const one = await runSelect(dir, { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF_TYPE: 'branch', APP_FILTER: 'plain' });
    expect(one.keys).toEqual(['plain/android']);
    expect(one.r.outputs['has_ota']).toBe('false');
    const every = await runSelect(dir, { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF_TYPE: 'branch' });
    expect(every.keys).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// plan/route: fingerprint + tag lookup
// ---------------------------------------------------------------------------

describe('plan route step (fingerprint routing)', () => {
  const content = render();
  const route = getStep(content, 'plan', 'route');
  const all = legs(content);

  /** Origin bare repo + working clone with an app dir whose expo-updates CLI is stubbed. */
  function workspace(cliBody: string): { work: string; origin: string; bin: string; installLog: string } {
    const root = tmp();
    const origin = join(root, 'origin.git');
    const work = join(root, 'work');
    git(root, 'init', '--bare', '-q', origin);
    git(root, 'clone', '-q', origin, work);
    for (const app of ['alpha', 'beta']) {
      const cliDir = join(work, 'apps', app, 'node_modules', 'expo-updates', 'bin');
      mkdirSync(cliDir, { recursive: true });
      writeFileSync(join(work, 'apps', app, 'node_modules', 'expo-updates', 'package.json'), '{"name":"expo-updates"}');
      writeFileSync(join(cliDir, 'cli.js'), cliBody);
    }
    commitFile(work, 'README.md');
    git(work, 'push', '-q', 'origin', 'HEAD');
    // package-manager stub: records the dir it installed in
    const bin = join(root, 'bin');
    const installLog = join(root, 'install.log');
    mkdirSync(bin);
    writeFileSync(join(bin, 'yarn'), `#!/bin/sh\npwd >> "${installLog}"\n`);
    chmodSync(join(bin, 'yarn'), 0o755);
    writeFileSync(installLog, '');
    return { work, origin, bin, installLog };
  }

  /** Prints a log line, then `{"runtimeVersion":"<platform>-<FOO>"}`. */
  const perPlatformCli =
    `if (process.argv[2] !== 'runtimeversion:resolve') process.exit(3);\n` +
    `console.log('resolving');\n` +
    `console.log(JSON.stringify({ runtimeVersion: process.argv[4] + 'hash' + (process.env.FOO || '') }));\n`;

  async function runRoute(ws: { work: string; bin: string }, selected: Leg[]) {
    return runStep(route, {
      cwd: ws.work,
      env: { RNW_SELECTED: JSON.stringify(selected) },
      pathDirs: [ws.bin],
    });
  }

  test('routes each ota leg by its own platform tag: tagged → ota, untagged → native; non-ota → native', async () => {
    const ws = workspace(perPlatformCli);
    git(ws.work, 'tag', 'rnw/native/alpha/production/ios/ioshash');
    git(ws.work, 'push', '-q', 'origin', '--tags');
    const r = await runRoute(ws, all);
    expect(r.code).toBe(0);
    const ota = JSON.parse(r.outputs['ota']!) as Leg[];
    const native = JSON.parse(r.outputs['native']!) as Leg[];
    expect(ota.map((l) => `${l.app}/${l.platform}/${l.hash}`)).toEqual(['alpha/ios/ioshash']);
    expect(native.map((l) => `${l.app}/${l.platform}/${l.hash ?? '-'}`).sort()).toEqual([
      'alpha/android/androidhash',
      'beta/android/androidhash',
      'plain/android/-',
    ]);
    // installs once per ota app dir
    const installs = readFileSync(ws.installLog, 'utf8').trim().split('\n').map((p) => p.split('/').pop());
    expect(installs).toEqual(['alpha', 'beta']);
  });

  test('fingerprint resolves with the leg ci.env exported', async () => {
    const ws = workspace(perPlatformCli);
    const leg = { ...all.find((l) => l.app === 'beta')!, env: '{"FOO":"bar"}' };
    const r = await runRoute(ws, [leg]);
    expect(r.code).toBe(0);
    expect((JSON.parse(r.outputs['native']!) as Leg[])[0]!.hash).toBe('androidhashbar');
  });

  test('no ota legs selected: no install, everything native', async () => {
    const ws = workspace(perPlatformCli);
    const plain = all.filter((l) => !l.ota);
    const r = await runRoute(ws, plain);
    expect(r.code).toBe(0);
    expect(r.outputs['ota']).toBe('[]');
    expect(JSON.parse(r.outputs['native']!)).toEqual(plain);
    expect(readFileSync(ws.installLog, 'utf8')).toBe('');
  });

  test('empty selection routes nothing', async () => {
    const ws = workspace(perPlatformCli);
    const r = await runRoute(ws, []);
    expect(r.code).toBe(0);
    expect(r.outputs['ota']).toBe('[]');
    expect(r.outputs['native']).toBe('[]');
  });

  test('fails when both platforms of an app×profile resolve the same runtimeVersion', async () => {
    const ws = workspace(
      `console.log(JSON.stringify({ runtimeVersion: '1.0.0' }));\n`,
    );
    const r = await runRoute(ws, all.filter((l) => l.app === 'alpha'));
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('runtimeVersion: { policy: "fingerprint" }');
  });

  test('fails on a missing or unsafe runtimeVersion', async () => {
    for (const body of [
      `console.log(JSON.stringify({ runtimeVersion: null }));\n`,
      `console.log(JSON.stringify({ runtimeVersion: 'a b;rm' }));\n`,
    ]) {
      const ws = workspace(body);
      const r = await runRoute(ws, all.filter((l) => l.app === 'beta'));
      expect(r.code).not.toBe(0);
      expect(r.rawOutput).not.toContain('ota=');
    }
  });
});

// ---------------------------------------------------------------------------
// #54: staging + Maestro e2e + auto-promote in the ota / native legs
// ---------------------------------------------------------------------------

describe('matrix e2e legs (#54)', () => {
  const content = render();
  const ota = job(content, 'ota');
  const native = job(content, 'native');
  const smart = parseWorkflow(generateGithubActions(otaAll, { scheme: 'Alpha' })[0]!.content);
  const smartNoE2e = parseWorkflow(
    generateGithubActions({ ...otaAll, build: { production: { ...otaAll.build.production!, e2e: undefined } } }, { scheme: 'Alpha' })[0]!
      .content,
  );
  const selfHostedContent = render([{ dir: 'apps/solo', slug: 'solo', config: otaIosSelfHosted }]);

  const ix = (j: WorkflowJob, id: string): number => j.steps.findIndex((s) => s.id === id);
  const step = (j: WorkflowJob, id: string): WorkflowStep => {
    const s = j.steps.find((x) => x.id === id);
    if (!s) throw new Error(`step ${id} missing`);
    return s;
  };
  const leg = (platform: 'ios' | 'android', e2e: boolean, selfHosted = false): Record<string, unknown> => ({
    platform,
    e2e,
    ota: true,
    selfHosted,
  });
  const running = (j: WorkflowJob, ctx: IfContext): string[] =>
    j.steps.filter((s) => stepRuns(s, ctx)).map((s) => s.id ?? s.name ?? '');

  test('legs carry the Maestro appId (ios bundleId, android packageName); empty without e2e', () => {
    const all = legs(content);
    expect(all.find((l) => l.app === 'alpha' && l.platform === 'ios')!.appId).toBe('com.example.otaall');
    expect(all.find((l) => l.app === 'alpha' && l.platform === 'android')!.appId).toBe('com.example.otaall');
    expect(all.find((l) => l.app === 'beta')!.appId).toBe('');
  });

  for (const p of ['ios', 'android'] as const) {
    test(`ota ${p} e2e leg: package → upload(staging) → binary → guard → flows → promote`, () => {
      const ran = running(ota, { matrix: leg(p, true), steps: { fresh: { promote: 'true' } } });
      const order = ['update-id', 'upload-staging', `${p}-e2e-build`, `${p}-guard-flow`, `${p}-maestro`, 'fresh', 'promote'];
      const at = order.map((id) => ran.indexOf(id));
      expect(at.every((i) => i >= 0)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      expect(ran.at(-1)).toBe('promote');
      expect(ran).not.toContain('upload');
      const other = p === 'ios' ? 'android' : 'ios';
      expect(ran.some((id) => id.startsWith(`${other}-`))).toBe(false);
    });

    test(`ota ${p}: channels, cache key, update id and appId come from the leg`, () => {
      expect(step(ota, 'upload-staging').env?.['RNW_CHANNEL']).toBe('${{ matrix.stagingChannel }}');
      expect(step(ota, 'promote').env?.['RNW_CHANNEL']).toBe('${{ matrix.otaChannel }}');
      for (const id of ['upload-staging', 'promote']) expect(step(ota, id).env?.['RNW_HASH']).toBe('${{ matrix.hash }}');
      expect(step(ota, `${p}-e2e-cache`).with?.['key']).toBe('${{ matrix.e2eCachePrefix }}${{ matrix.hash }}');
      expect(step(ota, `${p}-e2e-build`).env?.['EXPO_UPDATES_FINGERPRINT_OVERRIDE']).toBe('${{ matrix.hash }}');
      expect(step(ota, `${p}-e2e-patch`).env?.['RNW_STAGING_CHANNEL']).toBe('${{ matrix.stagingChannel }}');
      const maestro = step(ota, `${p}-maestro`);
      expect(maestro.env?.['RNW_EXPECTED_UPDATE_ID']).toBe('${{ steps.update-id.outputs.update_id }}');
      expect(maestro.env?.['RNW_APP_ID']).toBe('${{ matrix.appId }}');
      expect(maestro.env?.['RNW_FLOWS']).toBe('${{ matrix.flows }}');
    });

    test(`ota ${p}: cached test binary skips the build`, () => {
      const ran = running(ota, { matrix: leg(p, true), steps: { [`${p}-e2e-cache`]: { 'cache-hit': 'true' } } });
      expect(ran).toContain(`${p}-e2e-cache`);
      expect(ran).not.toContain(`${p}-e2e-build`);
      expect(ran).toContain(`${p}-maestro`);
    });

    test(`ota ${p} leg without e2e uploads straight to the channel`, () => {
      const ran = running(ota, { matrix: leg(p, false) });
      expect(ran).toContain('upload');
      for (const id of ['upload-staging', 'promote', `${p}-maestro`, `${p}-e2e-build`]) expect(ran).not.toContain(id);
    });

    test(`native ${p} e2e leg: fresh binary → flows (no guard) → save → recheck → fastlane → tag`, () => {
      const ran = running(native, { matrix: leg(p, true), steps: { recheck: { exists: 'false' } } });
      const order = [`${p}-e2e-build`, `${p}-maestro`, `${p}-e2e-save`, 'recheck', 'fastlane', 'tag'];
      const at = order.map((id) => ran.indexOf(id));
      expect(at.every((i) => i >= 0)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      expect(ran.some((id) => id.startsWith('ota-'))).toBe(false);
      expect(native.steps.some((s) => s.id === `${p}-e2e-cache`)).toBe(false);
      expect(native.steps.some((s) => s.id === `${p}-guard-flow`)).toBe(false);
      expect(step(native, `${p}-maestro`).env?.['RNW_EXPECTED_UPDATE_ID']).toBeUndefined();
    });

    test(`native ${p}: recheck hit ships this commit as an OTA (staging → e2e → promote), no fastlane/tag`, () => {
      const ran = running(native, { matrix: leg(p, true), steps: { recheck: { exists: 'true' }, 'ota-fresh': { promote: 'true' } } });
      expect(ran).not.toContain('fastlane');
      expect(ran).not.toContain('tag');
      const order = ['ota-update-id', 'ota-upload-staging', `ota-${p}-e2e-cache`, `ota-${p}-e2e-build`, `ota-${p}-guard-flow`, `ota-${p}-maestro`, 'ota-fresh', 'ota-promote'];
      const at = order.map((id) => ran.indexOf(id));
      expect(at.every((i) => i >= 0)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      expect(ran.at(-1)).toBe('ota-promote');
      expect(ran).not.toContain('ota-upload');
      expect(step(native, `ota-${p}-maestro`).env?.['RNW_EXPECTED_UPDATE_ID']).toBe('${{ steps.ota-update-id.outputs.update_id }}');
      expect(step(native, `ota-${p}-e2e-cache`).with?.['key']).toBe('${{ matrix.e2eCachePrefix }}${{ matrix.hash }}');
      expect(step(native, 'ota-upload-staging').env?.['RNW_CHANNEL']).toBe('${{ matrix.stagingChannel }}');
      expect(step(native, 'ota-promote').env?.['RNW_CHANNEL']).toBe('${{ matrix.otaChannel }}');
    });

    test(`native ${p}: recheck hit without e2e uploads straight to the channel`, () => {
      const ran = running(native, { matrix: leg(p, false), steps: { recheck: { exists: 'true' } } });
      expect(ran).toContain('ota-upload');
      expect(ran.indexOf('ota-upload')).toBeGreaterThan(ran.indexOf('ota-update-id'));
      for (const id of ['fastlane', 'tag', 'ota-upload-staging', 'ota-promote', `ota-${p}-maestro`]) expect(ran).not.toContain(id);
      expect(step(native, 'ota-upload').env?.['RNW_CHANNEL']).toBe('${{ matrix.otaChannel }}');
    });
  }

  test('native non-ota leg: no recheck, no OTA fallback, fastlane + no tag', () => {
    const ran = running(native, { matrix: { platform: 'android', e2e: false, ota: false, selfHosted: false } });
    expect(ran).toContain('fastlane');
    expect(ran.some((id) => id.startsWith('ota-') || id === 'recheck' || id === 'tag')).toBe(false);
  });

  test('upload / update-id / guard / promote scripts are byte-identical to the smart workflow', () => {
    const sIos = smart.jobs['ota-ios']!;
    const sAndroid = smart.jobs['ota-android']!;
    const pairs: [WorkflowStep, WorkflowStep][] = [
      [step(sIos, 'update-id'), step(ota, 'update-id')],
      [step(sIos, 'package'), step(ota, 'package')],
      [step(sIos, 'upload-staging'), step(ota, 'upload-staging')],
      [step(sIos, 'promote'), step(ota, 'promote')],
      [step(sIos, 'guard-flow'), step(ota, 'ios-guard-flow')],
      [step(sAndroid, 'guard-flow'), step(ota, 'android-guard-flow')],
      [step(sIos, 'maestro'), step(ota, 'ios-maestro')],
      [step(sAndroid, 'maestro-script'), step(ota, 'android-maestro-script')],
      [step(smartNoE2e.jobs['ota-ios']!, 'upload'), step(ota, 'upload')],
      [step(sIos, 'update-id'), step(native, 'ota-update-id')],
      [step(sIos, 'upload-staging'), step(native, 'ota-upload-staging')],
      [step(sIos, 'promote'), step(native, 'ota-promote')],
      [step(sIos, 'guard-flow'), step(native, 'ota-ios-guard-flow')],
      [step(sIos, 'maestro'), step(native, 'ota-ios-maestro')],
    ];
    for (const [a, b] of pairs) {
      expect({ id: b.id, run: b.run }).toEqual({ id: b.id, run: a.run });
    }
  });

  test('ios: simctl UDID boot + install; device name from the leg', () => {
    const sim = step(ota, 'ios-simulator');
    expect(sim.run).toContain('xcrun simctl install "$UDID"');
    expect(sim.env?.['RNW_IOS_DEVICE']).toBe('${{ matrix.iosDevice }}');
    expect(step(ota, 'ios-maestro').env?.['RNW_UDID']).toBe('${{ steps.ios-simulator.outputs.udid }}');
    expect(step(native, 'ota-ios-maestro').env?.['RNW_UDID']).toBe('${{ steps.ota-ios-simulator.outputs.udid }}');
  });

  test('android: pinned emulator runner in the leg dir, KVM only on hosted runners', () => {
    for (const [j, prefix] of [[ota, 'android-'], [native, 'android-'], [native, 'ota-android-']] as const) {
      const emu = step(j, `${prefix}maestro`);
      expect(emu.uses).toBe('reactivecircus/android-emulator-runner@v2.38.0');
      expect(emu.with?.['working-directory']).toBe('${{ matrix.dir }}');
      expect(String(emu.with?.['script'])).not.toContain('${{');
    }
    const kvm = ota.steps.find((s) => s.name === 'Enable KVM')!;
    expect(stepRuns(kvm, { matrix: leg('android', true) })).toBe(true);
    expect(stepRuns(kvm, { matrix: leg('android', true, true) })).toBe(false);
    expect(stepRuns(kvm, { matrix: leg('ios', true) })).toBe(false);
  });

  test('self-hosted ios leg: no setup-xcode in ota, Maestro install conditional', () => {
    const shOta = job(selfHostedContent, 'ota');
    const xcode = shOta.steps.find((s) => s.uses?.startsWith('maxim-lobanov/setup-xcode'))!;
    expect(stepRuns(xcode, { matrix: leg('ios', true, true) })).toBe(false);
    expect(stepRuns(xcode, { matrix: leg('ios', true, false) })).toBe(true);
    expect(stepRuns(xcode, { matrix: leg('ios', false, false) })).toBe(false);
    const ran = running(shOta, { matrix: leg('ios', true, true) });
    expect(ran).toContain('ios-maestro-install');
    expect(step(shOta, 'ios-maestro-install').run).toContain('command -v maestro');
    expect(selfHostedContent.toLowerCase()).not.toContain('android');
  });

  test('hosted ota android e2e leg sets up the JDK before building', () => {
    const jdk = ota.steps.findIndex((s) => s.uses?.startsWith('actions/setup-java') && stepRuns(s, { matrix: leg('android', true) }));
    expect(jdk).toBeGreaterThan(-1);
    expect(jdk).toBeLessThan(ix(ota, 'android-e2e-build'));
  });

  test('no always()/failure()/cancelled()/continue-on-error on the ota or native step paths', () => {
    for (const j of [ota, native]) {
      for (const s of j.steps) {
        expect(String(s.if ?? '')).not.toMatch(/always\(\)|failure\(\)|cancelled\(\)/);
        expect((s as Record<string, unknown>)['continue-on-error']).toBeUndefined();
      }
    }
  });

  test('every step id is unique per job', () => {
    for (const j of [ota, native]) {
      const ids = j.steps.map((s) => s.id).filter((id): id is string => id !== undefined);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
