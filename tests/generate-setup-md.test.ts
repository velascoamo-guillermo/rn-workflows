import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * End-to-end coverage for the CI-secrets summary #30 adds to `generate`:
 * a terminal summary of required secrets plus a `SETUP.md` sibling to
 * `fastlane/`, both derived from what was actually rendered.
 */
describe('generate CI secrets summary + SETUP.md (CLI)', () => {
  const cli = resolve(import.meta.dir, '..', 'src', 'index.ts');

  const appYaml = (distribution: string): string =>
    [
      'project:',
      '  type: bare',
      '  bundleId: com.test.app',
      '  packageName: com.test.app',
      'ci:',
      '  provider: github-actions',
      'build:',
      '  preview:',
      '    platform: android',
      `    distribution: ${distribution}`,
      '',
    ].join('\n');

  function makeRepo(distribution: string): { root: string; appDir: string } {
    const root = mkdtempSync(join(tmpdir(), 'rnwf-gen-secrets-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    const appDir = join(root, 'apps', 'mobile');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, 'rn-workflows.yml'), appYaml(distribution));
    return { root, appDir };
  }

  function runGenerate(appDir: string, extraArgs: string[] = []): string {
    return execFileSync('bun', [cli, 'generate', '--cwd', appDir, ...extraArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  }

  test('emits SETUP.md next to fastlane/ and prints a secrets summary when secrets are required', () => {
    const { root, appDir } = makeRepo('firebase');
    try {
      const output = runGenerate(appDir);
      const setupPath = join(appDir, 'SETUP.md');
      expect(existsSync(setupPath)).toBe(true);
      const content = readFileSync(setupPath, 'utf8');
      expect(content).toContain('FIREBASE_APP_ID_ANDROID');
      expect(content).toContain('FIREBASE_SERVICE_ACCOUNT_JSON');
      expect(content).toContain('gh secret set FIREBASE_APP_ID_ANDROID');

      expect(output).toContain('Required CI secrets');
      expect(output).toContain('gh secret set FIREBASE_APP_ID_ANDROID');
      expect(output).toContain('rn-workflows setup');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // "omits SETUP.md when zero secrets are required" used to be tested here
  // via `platform: android, distribution: github-releases`. Post-review-fix
  // that combo now correctly requires GITHUB_TOKEN (see #30 review item 3),
  // and no other schema-valid (platform, distribution) combination maps to
  // zero secrets, so the zero-secrets branch in generate.ts can no longer be
  // reached through a valid rn-workflows.yml. It's still covered at the unit
  // level — deriveRequiredSecrets([]) for an out-of-schema config — in
  // tests/secrets-derive.test.ts.

  test('--dry-run reports SETUP.md without writing it', () => {
    const { root, appDir } = makeRepo('firebase');
    try {
      const output = runGenerate(appDir, ['--dry-run']);
      expect(existsSync(join(appDir, 'SETUP.md'))).toBe(false);
      expect(output).toContain('would write SETUP.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
