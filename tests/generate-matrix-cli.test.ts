import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
});
