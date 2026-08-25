import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * `generate --matrix` (#30/#34): the single-app `generate` path prints a
 * required-secrets summary and writes SETUP.md, but --matrix skipped both —
 * deferred from #30, picked up here. Union across every discovered app's
 * config, deduped by name, at the git root (fastlane files/SETUP.md stay
 * per-app for plain `generate`, but the matrix workflow itself is one file
 * at the root, so its summary lives there too).
 */
describe('generate --matrix secrets summary + SETUP.md (#34)', () => {
  const cli = resolve(import.meta.dir, '..', 'src', 'index.ts');

  const appYaml = (bundleId: string, platform: string, distribution: string): string =>
    [
      'project:',
      '  type: bare',
      `  bundleId: ${bundleId}`,
      `  packageName: ${bundleId}`,
      'ci:',
      '  provider: github-actions',
      'build:',
      '  preview:',
      `    platform: ${platform}`,
      `    distribution: ${distribution}`,
      '',
    ].join('\n');

  function makeMonorepo(): string {
    const root = mkdtempSync(join(tmpdir(), 'rnwf-matrix-secrets-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    mkdirSync(join(root, 'apps', 'a'), { recursive: true });
    mkdirSync(join(root, 'apps', 'b'), { recursive: true });
    // Both apps require FIREBASE_SERVICE_ACCOUNT_JSON — proves dedup, not
    // just union — plus one app-unique secret each.
    writeFileSync(join(root, 'apps', 'a', 'rn-workflows.yml'), appYaml('com.test.a', 'android', 'firebase'));
    writeFileSync(join(root, 'apps', 'b', 'rn-workflows.yml'), appYaml('com.test.b', 'ios', 'firebase'));
    return root;
  }

  function runMatrix(root: string, extraArgs: string[] = []): string {
    return execFileSync('bun', [cli, 'generate', '--matrix', '--cwd', root, ...extraArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  }

  test('prints a union secrets summary and writes one SETUP.md at the git root', () => {
    const root = makeMonorepo();
    try {
      const output = runMatrix(root);

      expect(output).toContain('Required CI secrets');
      expect(output).toContain('gh secret set FIREBASE_APP_ID_ANDROID');
      expect(output).toContain('gh secret set FIREBASE_APP_ID_IOS');

      const setupPath = join(root, 'SETUP.md');
      expect(existsSync(setupPath)).toBe(true);
      const content = readFileSync(setupPath, 'utf8');
      expect(content).toContain('FIREBASE_APP_ID_ANDROID');
      expect(content).toContain('FIREBASE_APP_ID_IOS');

      // deduped: FIREBASE_SERVICE_ACCOUNT_JSON is required by both apps but
      // must appear exactly once in the summary and exactly one heading in
      // SETUP.md.
      const setCount = output.split('\n').filter((l) => l.includes('gh secret set FIREBASE_SERVICE_ACCOUNT_JSON')).length;
      expect(setCount).toBe(1);
      const headingCount = content.split('\n').filter((l) => l === '## FIREBASE_SERVICE_ACCOUNT_JSON').length;
      expect(headingCount).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('--dry-run reports SETUP.md without writing it', () => {
    const root = makeMonorepo();
    try {
      const output = runMatrix(root, ['--dry-run']);
      expect(existsSync(join(root, 'SETUP.md'))).toBe(false);
      expect(output).toContain('would write SETUP.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
