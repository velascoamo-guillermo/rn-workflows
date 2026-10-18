import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { MATRIX_WORKFLOW_FILENAME } from '../src/generators/github-matrix';

/**
 * CLI-level coverage for how `generate --matrix` resolves the workflows
 * output directory (issue #16):
 *   flag > unanimous per-app ci.workflowsDir > <gitRoot>/.github/workflows.
 * Divergent/partial per-app values are ignored with a warning.
 */
describe('generate --matrix workflowsDir resolution (CLI)', () => {
  const cli = resolve(import.meta.dir, '..', 'src', 'index.ts');

  const appYaml = (bundleId: string, workflowsDir?: string): string =>
    [
      'project:',
      '  type: bare',
      `  bundleId: ${bundleId}`,
      `  packageName: ${bundleId}`,
      'ci:',
      '  provider: github-actions',
      ...(workflowsDir ? [`  workflowsDir: ${workflowsDir}`] : []),
      'build:',
      '  preview:',
      '    platform: android',
      '    distribution: firebase',
      '',
    ].join('\n');

  function makeMonorepo(workflowsDirs: {
    a?: string;
    b?: string;
  }): string {
    const root = mkdtempSync(join(tmpdir(), 'rnwf-matrix-wfdir-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    mkdirSync(join(root, 'apps', 'a'), { recursive: true });
    mkdirSync(join(root, 'apps', 'b'), { recursive: true });
    writeFileSync(
      join(root, 'apps', 'a', 'rn-workflows.yml'),
      appYaml('com.test.a', workflowsDirs.a),
    );
    writeFileSync(
      join(root, 'apps', 'b', 'rn-workflows.yml'),
      appYaml('com.test.b', workflowsDirs.b),
    );
    return root;
  }

  function runMatrix(root: string, extraArgs: string[] = []): string {
    return execFileSync('bun', [cli, 'generate', '--matrix', '--cwd', root, ...extraArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  }

  test('unanimous ci.workflowsDir is used, resolved against the git root', () => {
    const root = makeMonorepo({ a: 'ci/workflows', b: 'ci/workflows' });
    try {
      const out = runMatrix(root);
      expect(existsSync(join(root, 'ci', 'workflows', MATRIX_WORKFLOW_FILENAME))).toBe(true);
      expect(existsSync(join(root, '.github', 'workflows', MATRIX_WORKFLOW_FILENAME))).toBe(false);
      expect(out).not.toContain('--workflows-dir');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('divergent ci.workflowsDir values fall back to the default and warn', () => {
    const root = makeMonorepo({ a: 'ci/workflows', b: 'other/workflows' });
    try {
      const out = runMatrix(root);
      expect(existsSync(join(root, '.github', 'workflows', MATRIX_WORKFLOW_FILENAME))).toBe(true);
      expect(existsSync(join(root, 'ci', 'workflows', MATRIX_WORKFLOW_FILENAME))).toBe(false);
      expect(out).toContain('apps/a');
      expect(out).toContain('apps/b');
      expect(out).toContain('--workflows-dir');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('--workflows-dir flag wins over a unanimous ci.workflowsDir', () => {
    const root = makeMonorepo({ a: 'ci/workflows', b: 'ci/workflows' });
    try {
      runMatrix(root, ['--workflows-dir', 'flag-workflows']);
      expect(existsSync(join(root, 'flag-workflows', MATRIX_WORKFLOW_FILENAME))).toBe(true);
      expect(existsSync(join(root, 'ci', 'workflows', MATRIX_WORKFLOW_FILENAME))).toBe(false);
      expect(existsSync(join(root, '.github', 'workflows', MATRIX_WORKFLOW_FILENAME))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  describe('slug uniqueness', () => {
    function makeCollidingMonorepo(dirs: [string, string]): string {
      const root = mkdtempSync(join(tmpdir(), 'rnwf-matrix-slugs-'));
      execFileSync('git', ['init', '-q'], { cwd: root });
      for (const [i, dir] of dirs.entries()) {
        mkdirSync(join(root, dir), { recursive: true });
        writeFileSync(join(root, dir, 'rn-workflows.yml'), appYaml(`com.test.app${i}`));
      }
      return root;
    }

    test('duplicate basenames fall back to path-derived slugs in the matrix', () => {
      const root = makeCollidingMonorepo(['apps/a/mobile', 'apps/b/mobile']);
      try {
        const out = runMatrix(root);
        expect(out).toContain('apps-a-mobile');
        expect(out).toContain('apps-b-mobile');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('fails loudly when even path-derived slugs collide', () => {
      const root = makeCollidingMonorepo(['apps/a-b', 'apps/a_b']);
      try {
        expect(() => runMatrix(root)).toThrow();
        expect(existsSync(join(root, '.github', 'workflows', MATRIX_WORKFLOW_FILENAME))).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });
});

/** #53: OTA-mode matrix — per-app Xcode scheme + git-root workflow path. */
describe('generate --matrix with ota apps (CLI)', () => {
  const cli = resolve(import.meta.dir, '..', 'src', 'index.ts');

  const otaYaml = (bundleId: string): string =>
    [
      'project:',
      '  type: expo',
      `  bundleId: ${bundleId}`,
      `  packageName: ${bundleId}`,
      'ci: github-actions',
      'build:',
      '  production:',
      '    platform: ios',
      '    distribution: testflight',
      '    ota:',
      '      server: http://localhost:3000',
      '      channel: production',
      '    e2e:',
      '      maestro:',
      '        flows: .maestro',
      '',
    ].join('\n');

  function makeOtaMonorepo(): string {
    const root = mkdtempSync(join(tmpdir(), 'rnwf-matrix-ota-cli-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    for (const [app, name] of [['petcare', 'Pet Care'], ['sleep', undefined]] as const) {
      mkdirSync(join(root, 'apps', app), { recursive: true });
      writeFileSync(join(root, 'apps', app, 'rn-workflows.yml'), otaYaml(`com.shipyard.${app}`));
      if (name) writeFileSync(join(root, 'apps', app, 'app.json'), JSON.stringify({ expo: { name } }));
    }
    return root;
  }

  interface Leg {
    app: string;
    scheme: string;
    paths: string[];
  }

  function readLegs(file: string): Leg[] {
    const parsed = yaml.load(readFileSync(file, 'utf8')) as { jobs: { plan: { env: { RELEASE_LEGS: string } } } };
    return JSON.parse(parsed.jobs.plan.env.RELEASE_LEGS) as Leg[];
  }

  test('each leg carries its own detected scheme (bundle-id fallback when undetectable)', () => {
    const root = makeOtaMonorepo();
    try {
      execFileSync('bun', [cli, 'generate', '--matrix', '--cwd', join(root, 'apps', 'sleep')], { stdio: 'pipe' });
      const legs = readLegs(join(root, '.github', 'workflows', MATRIX_WORKFLOW_FILENAME));
      expect(legs.map((l) => `${l.app}:${l.scheme}`)).toEqual(['petcare:PetCare', 'sleep:sleep']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('workflow lands at the git root; legs watch its root-relative path', () => {
    const root = makeOtaMonorepo();
    try {
      execFileSync('bun', [cli, 'generate', '--matrix', '--cwd', join(root, 'apps', 'petcare')], { stdio: 'pipe' });
      const legs = readLegs(join(root, '.github', 'workflows', MATRIX_WORKFLOW_FILENAME));
      expect(legs[0]!.paths).toEqual(['apps/petcare/', `.github/workflows/${MATRIX_WORKFLOW_FILENAME}`]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('--workflows-dir is reflected in the watched workflow path', () => {
    const root = makeOtaMonorepo();
    try {
      execFileSync('bun', [cli, 'generate', '--matrix', '--cwd', root, '--workflows-dir', 'ci/wf'], { stdio: 'pipe' });
      const legs = readLegs(join(root, 'ci', 'wf', MATRIX_WORKFLOW_FILENAME));
      expect(legs[0]!.paths).toEqual(['apps/petcare/', `ci/wf/${MATRIX_WORKFLOW_FILENAME}`]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
