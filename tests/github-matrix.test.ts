import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';
import { discoverConfigs } from '../src/utils/monorepo';
import {
  generateMatrixWorkflow,
  MATRIX_WORKFLOW_FILENAME,
  type MatrixApp,
} from '../src/generators/github-matrix';
import type { Config } from '../src/config/schema';

const pawlogConfig: Config = {
  project: { type: 'expo', bundleId: 'com.shipyard.pawlog', packageName: 'com.shipyard.pawlog' },
  ci: 'github-actions',
  checks: { test: true, typecheck: true },
  build: {
    production: {
      platform: 'all',
      distribution: 'store',
      android: { buildType: 'aab' },
      ota: { server: 'https://ota.shipyard.dev', channel: 'production' },
    },
  },
};

const vaultyConfig: Config = {
  project: { type: 'bare', bundleId: 'com.shipyard.vaulty', packageName: 'com.shipyard.vaulty' },
  ci: 'github-actions',
  build: {
    preview: { platform: 'android', distribution: 'firebase' },
  },
};

const apps: MatrixApp[] = [
  { dir: 'apps/pawlog', slug: 'pawlog', config: pawlogConfig },
  { dir: 'apps/vaulty', slug: 'vaulty', config: vaultyConfig },
];

interface StepYaml {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string | boolean;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}

interface JobYaml {
  needs?: string | string[];
  if?: string;
  'runs-on'?: string;
  strategy?: { 'fail-fast'?: boolean; matrix?: { include?: unknown } };
  defaults?: { run?: { 'working-directory'?: string } };
  env?: Record<string, string>;
  outputs?: Record<string, string>;
  steps: StepYaml[];
}

interface WorkflowYaml {
  on: {
    workflow_dispatch?: { inputs?: Record<string, { required?: boolean }> };
    push?: { branches?: string[]; tags?: string[]; paths?: string[] };
  };
  jobs: Record<string, JobYaml>;
}

interface ReleaseLeg {
  app: string;
  dir: string;
  profile: string;
  platform: string;
  runsOn: string;
  ota: boolean;
  otaServer: string;
  otaChannel: string;
}

interface QualityLeg {
  app: string;
  dir: string;
  lint: boolean;
  typecheck: boolean;
  test: boolean;
}

function renderMatrix(input: MatrixApp[] = apps) {
  const file = generateMatrixWorkflow(input, { packageManager: 'bun' });
  const parsed = yaml.load(file.content) as WorkflowYaml;
  return { file, parsed };
}

function legsFromEnv<T>(parsed: WorkflowYaml, key: string): T[] {
  const raw = parsed.jobs['plan']?.env?.[key];
  expect(raw).toBeDefined();
  return JSON.parse(raw!) as T[];
}

describe('discoverConfigs', () => {
  function makeTree(): string {
    const root = mkdtempSync(join(tmpdir(), 'rnwf-matrix-'));
    mkdirSync(join(root, 'apps', 'pawlog'), { recursive: true });
    mkdirSync(join(root, 'apps', 'vaulty'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'some-pkg'), { recursive: true });
    mkdirSync(join(root, '.hidden'), { recursive: true });
    writeFileSync(join(root, 'apps', 'pawlog', 'rn-workflows.yml'), 'x: 1\n');
    writeFileSync(join(root, 'apps', 'vaulty', 'rn-workflows.yml'), 'x: 1\n');
    writeFileSync(join(root, 'node_modules', 'some-pkg', 'rn-workflows.yml'), 'x: 1\n');
    writeFileSync(join(root, '.hidden', 'rn-workflows.yml'), 'x: 1\n');
    return root;
  }

  test('finds every rn-workflows.yml under the root, sorted, as absolute paths', () => {
    const root = makeTree();
    try {
      const found = discoverConfigs(root);
      expect(found).toEqual([
        join(root, 'apps', 'pawlog', 'rn-workflows.yml'),
        join(root, 'apps', 'vaulty', 'rn-workflows.yml'),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('excludes node_modules and dot-directories', () => {
    const root = makeTree();
    try {
      const found = discoverConfigs(root);
      expect(found.some((p) => p.includes('node_modules'))).toBe(false);
      expect(found.some((p) => p.includes('.hidden'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('includes a config at the root itself', () => {
    const root = mkdtempSync(join(tmpdir(), 'rnwf-matrix-root-'));
    try {
      writeFileSync(join(root, 'rn-workflows.yml'), 'x: 1\n');
      expect(discoverConfigs(root)).toEqual([join(root, 'rn-workflows.yml')]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('returns empty array when nothing is found', () => {
    const root = mkdtempSync(join(tmpdir(), 'rnwf-matrix-empty-'));
    try {
      expect(discoverConfigs(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('generateMatrixWorkflow', () => {
  test('emits exactly one file named rn-release-matrix.yml in the workflows dir', () => {
    const file = generateMatrixWorkflow(apps, {
      packageManager: 'bun',
      workflowsDir: '/repo/.github/workflows',
    });
    expect(file.path).toBe(`/repo/.github/workflows/${MATRIX_WORKFLOW_FILENAME}`);
  });

  test('defaults workflows dir to .github/workflows', () => {
    const { file } = renderMatrix();
    expect(file.path).toBe(`.github/workflows/${MATRIX_WORKFLOW_FILENAME}`);
  });

  test('output is valid YAML', () => {
    const { file } = renderMatrix();
    expect(() => yaml.load(file.content)).not.toThrow();
  });

  test('triggers on workflow_dispatch (optional app input) and tag push — never on push paths', () => {
    const { parsed } = renderMatrix();
    expect(parsed.on.workflow_dispatch?.inputs?.['app']).toBeDefined();
    expect(parsed.on.workflow_dispatch?.inputs?.['app']?.required).toBe(false);
    expect(parsed.on.push?.tags).toEqual(['v*']);
    expect(parsed.on.push?.paths).toBeUndefined();
    expect(parsed.on.push?.branches).toBeUndefined();
  });

  test('release matrix has one leg per app × profile × platform', () => {
    const { parsed } = renderMatrix();
    const legs = legsFromEnv<ReleaseLeg>(parsed, 'RELEASE_LEGS');
    expect(legs).toHaveLength(3); // pawlog production android+ios, vaulty preview android
    expect(legs.map((l) => `${l.app}/${l.profile}/${l.platform}`).sort()).toEqual([
      'pawlog/production/android',
      'pawlog/production/ios',
      'vaulty/preview/android',
    ]);
  });

  test('release legs carry per-app dir and platform runner', () => {
    const { parsed } = renderMatrix();
    const legs = legsFromEnv<ReleaseLeg>(parsed, 'RELEASE_LEGS');
    const ios = legs.find((l) => l.platform === 'ios')!;
    const android = legs.find((l) => l.app === 'vaulty')!;
    expect(ios.dir).toBe('apps/pawlog');
    expect(ios.runsOn).toBe('macos-latest');
    expect(android.dir).toBe('apps/vaulty');
    expect(android.runsOn).toBe('ubuntu-latest');
  });

  test('a root-level app dir is normalised to "."', () => {
    const { parsed } = renderMatrix([{ dir: '', slug: 'solo', config: vaultyConfig }]);
    const legs = legsFromEnv<ReleaseLeg>(parsed, 'RELEASE_LEGS');
    expect(legs[0]!.dir).toBe('.');
  });

  test('ota legs carry server and channel; non-ota legs are flagged off', () => {
    const { parsed } = renderMatrix();
    const legs = legsFromEnv<ReleaseLeg>(parsed, 'RELEASE_LEGS');
    const ota = legs.find((l) => l.app === 'pawlog')!;
    const plain = legs.find((l) => l.app === 'vaulty')!;
    expect(ota.ota).toBe(true);
    expect(ota.otaServer).toBe('https://ota.shipyard.dev');
    expect(ota.otaChannel).toBe('production');
    expect(plain.ota).toBe(false);
  });

  test('quality matrix has one leg per app with checks enabled', () => {
    const { parsed } = renderMatrix();
    const legs = legsFromEnv<QualityLeg>(parsed, 'QUALITY_LEGS');
    expect(legs).toHaveLength(1);
    expect(legs[0]!.app).toBe('pawlog');
    expect(legs[0]!.dir).toBe('apps/pawlog');
    expect(legs[0]!.test).toBe(true);
    expect(legs[0]!.typecheck).toBe(true);
    expect(legs[0]!.lint).toBe(false);
  });

  test('plan job filters legs by the app dispatch input', () => {
    const { parsed } = renderMatrix();
    const plan = parsed.jobs['plan']!;
    const script = plan.steps.map((s) => s.run ?? '').join('\n');
    expect(script).toContain('select(.app == $app)');
    expect(plan.outputs?.['release']).toContain('steps.plan.outputs.release');
    expect(plan.outputs?.['quality']).toContain('steps.plan.outputs.quality');
  });

  test('quality and release jobs consume the plan matrix via fromJSON', () => {
    const { parsed } = renderMatrix();
    expect(parsed.jobs['quality']!.strategy?.matrix?.include).toBe(
      '${{ fromJSON(needs.plan.outputs.quality) }}',
    );
    expect(parsed.jobs['release']!.strategy?.matrix?.include).toBe(
      '${{ fromJSON(needs.plan.outputs.release) }}',
    );
  });

  test('matrix legs run with a per-app working-directory', () => {
    const { parsed } = renderMatrix();
    expect(parsed.jobs['quality']!.defaults?.run?.['working-directory']).toBe('${{ matrix.dir }}');
    expect(parsed.jobs['release']!.defaults?.run?.['working-directory']).toBe('${{ matrix.dir }}');
  });

  test('release job runs on the per-leg runner and needs plan + quality', () => {
    const { parsed } = renderMatrix();
    const release = parsed.jobs['release']!;
    expect(release['runs-on']).toBe('${{ matrix.runsOn }}');
    expect(release.needs).toEqual(['plan', 'quality']);
  });

  test('release job reuses smart-OTA steps gated per leg', () => {
    const { file, parsed } = renderMatrix();
    const release = parsed.jobs['release']!;
    const fp = release.steps.find((s) => s.id === 'fp');
    const cache = release.steps.find((s) => s.id === 'fp-cache');
    expect(fp).toBeDefined();
    expect(cache).toBeDefined();
    expect(String(cache!.if)).toContain('matrix.ota');
    expect(file.content).toContain('@expo/fingerprint');
    expect(file.content).toContain('${{ matrix.otaServer }}/api/upload');
    expect(file.content).toContain('channel=${{ matrix.otaChannel }}');
  });

  test('fastlane step runs the per-leg lane with the union of required secrets', () => {
    const { parsed } = renderMatrix();
    const release = parsed.jobs['release']!;
    const fastlane = release.steps.find((s) => s.run?.includes('bundle exec fastlane'));
    expect(fastlane).toBeDefined();
    expect(fastlane!.run).toContain('${{ matrix.platform }} ${{ matrix.profile }}');
    const env = fastlane!.env ?? {};
    // union across pawlog (store, ios+android) and vaulty (firebase, android)
    expect(env['PLAY_STORE_JSON_KEY']).toBe('${{ secrets.PLAY_STORE_JSON_KEY }}');
    expect(env['FIREBASE_APP_ID_ANDROID']).toBe('${{ secrets.FIREBASE_APP_ID_ANDROID }}');
    expect(env['APP_STORE_CONNECT_API_KEY_PATH']).toBe(
      '${{ secrets.APP_STORE_CONNECT_API_KEY_PATH }}',
    );
    expect(env['MATCH_PASSWORD']).toBe('${{ secrets.MATCH_PASSWORD }}');
    expect(env['MATCH_GIT_BASIC_AUTHORIZATION']).toBe(
      '${{ secrets.MATCH_GIT_BASIC_AUTHORIZATION }}',
    );
  });

  test('throws when given no apps', () => {
    expect(() => generateMatrixWorkflow([], {})).toThrow();
  });
});

describe('generate --matrix (CLI)', () => {
  const cli = resolve(import.meta.dir, '..', 'src', 'index.ts');

  const appYaml = (bundleId: string): string =>
    [
      'project:',
      '  type: bare',
      `  bundleId: ${bundleId}`,
      `  packageName: ${bundleId}`,
      'ci: github-actions',
      'build:',
      '  preview:',
      '    platform: android',
      '    distribution: firebase',
      '',
    ].join('\n');

  function makeMonorepo(): string {
    const root = mkdtempSync(join(tmpdir(), 'rnwf-matrix-cli-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    mkdirSync(join(root, 'apps', 'a'), { recursive: true });
    mkdirSync(join(root, 'apps', 'b'), { recursive: true });
    writeFileSync(join(root, 'apps', 'a', 'rn-workflows.yml'), appYaml('com.test.a'));
    writeFileSync(join(root, 'apps', 'b', 'rn-workflows.yml'), appYaml('com.test.b'));
    return root;
  }

  test('emits a single matrix workflow at the git root and no per-app workflows', () => {
    const root = makeMonorepo();
    try {
      execFileSync('bun', [cli, 'generate', '--matrix', '--cwd', root], { stdio: 'pipe' });
      const workflowsDir = join(root, '.github', 'workflows');
      expect(existsSync(join(workflowsDir, MATRIX_WORKFLOW_FILENAME))).toBe(true);
      expect(readdirSync(workflowsDir)).toEqual([MATRIX_WORKFLOW_FILENAME]);
      // matrix mode emits the workflow only — no fastlane files in app dirs
      expect(existsSync(join(root, 'apps', 'a', 'fastlane'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('fails with a clear error when no configs are discovered', () => {
    const root = mkdtempSync(join(tmpdir(), 'rnwf-matrix-cli-empty-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: root });
      expect(() =>
        execFileSync('bun', [cli, 'generate', '--matrix', '--cwd', root], { stdio: 'pipe' }),
      ).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
