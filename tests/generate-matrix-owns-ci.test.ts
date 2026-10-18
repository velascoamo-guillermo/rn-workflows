import { describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * I3: in a monorepo whose git root already carries the push-triggered matrix
 * workflow, per-app `generate` must not add a second per-app pipeline.
 */
describe('per-app generate when the matrix workflow exists', () => {
  const cli = resolve(import.meta.dir, '..', 'src', 'index.ts');
  const appYaml = [
    'project:',
    '  type: bare',
    '  bundleId: com.test.app',
    '  packageName: com.test.app',
    'ci:',
    '  provider: github-actions',
    'build:',
    '  preview:',
    '    platform: android',
    '    distribution: firebase',
    '',
  ].join('\n');

  function makeRepo(): { root: string; appDir: string } {
    const root = mkdtempSync(join(tmpdir(), 'rnwf-gen-matrix-owns-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    const appDir = join(root, 'apps', 'mobile');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, 'rn-workflows.yml'), appYaml);
    return { root, appDir };
  }

  function runGenerate(appDir: string): string {
    const r = spawnSync('bun', [cli, 'generate', '--cwd', appDir], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    return `${r.stdout}\n${r.stderr}`;
  }

  test('skips the per-app workflow and writes Fastlane files only', () => {
    const { root, appDir } = makeRepo();
    try {
      runGenerate(join(root, 'apps', 'mobile'));
      expect(existsSync(join(root, '.github', 'workflows', 'rn-mobile-preview.yml'))).toBe(true);
      rmSync(join(root, '.github', 'workflows', 'rn-mobile-preview.yml'));

      execFileSync('bun', [cli, 'generate', '--matrix', '--cwd', root], { stdio: 'ignore' });
      expect(existsSync(join(root, '.github', 'workflows', 'rn-release-matrix.yml'))).toBe(true);

      const out = runGenerate(appDir);
      expect(existsSync(join(root, '.github', 'workflows', 'rn-mobile-preview.yml'))).toBe(false);
      expect(existsSync(join(appDir, 'fastlane', 'Fastfile'))).toBe(true);
      expect(out).toContain('rn-release-matrix.yml');
      expect(out).toMatch(/matrix workflow owns CI/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('still writes the per-app workflow when no matrix workflow exists', () => {
    const { root, appDir } = makeRepo();
    try {
      const out = runGenerate(appDir);
      expect(existsSync(join(root, '.github', 'workflows', 'rn-mobile-preview.yml'))).toBe(true);
      expect(out).not.toMatch(/matrix workflow owns CI/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
