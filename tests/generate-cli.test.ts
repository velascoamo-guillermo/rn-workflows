import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Command-level coverage for how single-app `generate` wires
 * `--workflows-dir` / `ci.workflowsDir` through to the files actually
 * written on disk (the gap noted in the #6 review — util-level only).
 */
describe('generate workflowsDir wiring (CLI)', () => {
  const cli = resolve(import.meta.dir, '..', 'src', 'index.ts');

  const appYaml = (workflowsDir?: string): string =>
    [
      'project:',
      '  type: bare',
      '  bundleId: com.test.app',
      '  packageName: com.test.app',
      'ci:',
      '  provider: github-actions',
      ...(workflowsDir ? [`  workflowsDir: ${workflowsDir}`] : []),
      'build:',
      '  preview:',
      '    platform: android',
      '    distribution: firebase',
      '',
    ].join('\n');

  function makeRepo(workflowsDir?: string): { root: string; appDir: string } {
    const root = mkdtempSync(join(tmpdir(), 'rnwf-gen-wfdir-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    const appDir = join(root, 'apps', 'mobile');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, 'rn-workflows.yml'), appYaml(workflowsDir));
    return { root, appDir };
  }

  function runGenerate(appDir: string, extraArgs: string[] = []): string {
    return execFileSync('bun', [cli, 'generate', '--cwd', appDir, ...extraArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  }

  test('default writes workflows to <git root>/.github/workflows with slug prefix', () => {
    const { root, appDir } = makeRepo();
    try {
      runGenerate(appDir);
      expect(existsSync(join(root, '.github', 'workflows', 'rn-mobile-preview.yml'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('ci.workflowsDir relocates workflows, resolved against the app dir', () => {
    const { root, appDir } = makeRepo('ci/workflows');
    try {
      runGenerate(appDir);
      expect(existsSync(join(appDir, 'ci', 'workflows', 'rn-mobile-preview.yml'))).toBe(true);
      expect(existsSync(join(root, '.github', 'workflows', 'rn-mobile-preview.yml'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('--workflows-dir flag wins over ci.workflowsDir', () => {
    const { root, appDir } = makeRepo('ci/workflows');
    try {
      runGenerate(appDir, ['--workflows-dir', 'flag-workflows']);
      expect(existsSync(join(appDir, 'flag-workflows', 'rn-mobile-preview.yml'))).toBe(true);
      expect(existsSync(join(appDir, 'ci', 'workflows', 'rn-mobile-preview.yml'))).toBe(false);
      expect(existsSync(join(root, '.github', 'workflows', 'rn-mobile-preview.yml'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
