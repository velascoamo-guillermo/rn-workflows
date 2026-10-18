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

  const appYaml = (distribution: string, platform: string): string =>
    [
      'project:',
      '  type: bare',
      '  bundleId: com.test.app',
      '  packageName: com.test.app',
      'ci:',
      '  provider: github-actions',
      'build:',
      '  preview:',
      `    platform: ${platform}`,
      `    distribution: ${distribution}`,
      '',
    ].join('\n');

  function makeRepo(distribution: string, platform: string = 'android'): { root: string; appDir: string } {
    const root = mkdtempSync(join(tmpdir(), 'rnwf-gen-secrets-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    const appDir = join(root, 'apps', 'mobile');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, 'rn-workflows.yml'), appYaml(distribution, platform));
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

  // #34 review — Important: ASC_KEY_IS_BASE64 is a boolean flag with a
  // false-y default (Fastfile reads `ENV["ASC_KEY_IS_BASE64"] == "true"`),
  // not a value CI can't build without — so it must not inflate the
  // "Required CI secrets" count/checklist, even though SETUP.md still
  // documents it (under an optional heading).
  test('excludes the optional ASC_KEY_IS_BASE64 flag from the required-secrets summary, but still documents it in SETUP.md', () => {
    const { root, appDir } = makeRepo('testflight', 'ios');
    try {
      const output = runGenerate(appDir);
      const content = readFileSync(join(appDir, 'SETUP.md'), 'utf8');

      expect(content).toContain('## ASC_KEY_IS_BASE64 (optional)');
      expect(content).toContain('## APPLE_TEAM_ID');

      expect(output).not.toContain('gh secret set ASC_KEY_IS_BASE64');
      expect(output).toContain('gh secret set APPLE_TEAM_ID');
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

describe('generate OTA readiness section in SETUP.md (CLI)', () => {
  const cli = resolve(import.meta.dir, '..', 'src', 'index.ts');
  const fixtures = resolve(import.meta.dir, 'fixtures', 'expo-app-json');

  const yaml = (ota: boolean): string =>
    [
      'project:',
      '  type: expo',
      '  bundleId: com.test.app',
      '  packageName: com.test.app',
      'ci:',
      '  provider: github-actions',
      'build:',
      '  release:',
      '    platform: android',
      '    distribution: firebase',
      ...(ota ? ['    ota:', '      server: https://ota.example.com', '      channel: production'] : []),
      '',
    ].join('\n');

  function makeApp(root: string, name: string, fixture: string, ota: boolean): string {
    const dir = join(root, 'apps', name);
    mkdirSync(dir, { recursive: true });
    for (const f of ['app.json', 'app.config.ts', 'package.json']) {
      const src = join(fixtures, fixture, f);
      if (existsSync(src)) writeFileSync(join(dir, f), readFileSync(src));
    }
    writeFileSync(join(dir, 'rn-workflows.yml'), yaml(ota));
    return dir;
  }

  const run = (args: string[]): string =>
    execFileSync('bun', [cli, 'generate', ...args], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });

  test('with ota: SETUP.md gets the OTA section and the console prints warnings', () => {
    const root = mkdtempSync(join(tmpdir(), 'rnwf-ota-setup-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    try {
      const dir = makeApp(root, 'app', 'wrong-channel', true);
      const output = run(['--cwd', dir]);
      const content = readFileSync(join(dir, 'SETUP.md'), 'utf8');
      expect(content).toContain('## OTA updates');
      expect(content).toContain('expo-channel-name');
      expect(output).toContain('expo-channel-name');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('without ota: SETUP.md has no OTA section', () => {
    const root = mkdtempSync(join(tmpdir(), 'rnwf-ota-setup-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    try {
      const dir = makeApp(root, 'app', 'ready', false);
      run(['--cwd', dir]);
      expect(readFileSync(join(dir, 'SETUP.md'), 'utf8')).not.toContain('OTA updates');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('--matrix aggregates OTA findings per app in one section', () => {
    const root = mkdtempSync(join(tmpdir(), 'rnwf-ota-setup-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    try {
      makeApp(root, 'alpha', 'wrong-url', true);
      makeApp(root, 'beta', 'no-policy', true);
      run(['--matrix', '--cwd', root]);
      const content = readFileSync(join(root, 'SETUP.md'), 'utf8');
      expect(content.match(/## OTA updates/g)).toHaveLength(1);
      expect(content).toContain('apps/alpha/release');
      expect(content).toContain('updates.url');
      expect(content).toContain('apps/beta/release');
      expect(content).toContain('fingerprint');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
