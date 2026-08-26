import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';

/**
 * `init` was interactive-only (built entirely on `@clack/prompts`), which
 * makes it impossible to run in CI/scripts — e.g. the #31 e2e acceptance
 * suite that scaffolds a fresh app and runs `init && generate` end to end.
 * `--yes` adds a non-interactive path: flag values (or the same sane
 * defaults the prompts used) instead of prompting.
 */
describe('init --yes (non-interactive CLI)', () => {
  const cli = resolve(import.meta.dir, '..', 'src', 'index.ts');

  function makeDir(): string {
    return mkdtempSync(join(tmpdir(), 'rnwf-init-yes-'));
  }

  function runInit(cwd: string, extraArgs: string[] = []): string {
    return execFileSync('bun', [cli, 'init', '--cwd', cwd, '--yes', ...extraArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  }

  test('writes rn-workflows.yml with sane defaults, no prompts', () => {
    const dir = makeDir();
    try {
      runInit(dir);
      const raw = readFileSync(join(dir, 'rn-workflows.yml'), 'utf8');
      const config = yaml.load(raw) as {
        project: { type: string; bundleId: string; packageName: string };
        ci: string;
        build: Record<string, { distribution: string }>;
      };
      expect(config.project.type).toBe('expo');
      expect(config.project.bundleId).toBe('com.example.app');
      expect(config.project.packageName).toBe('com.example.app');
      expect(config.ci).toBe('github-actions');
      expect(Object.keys(config.build).sort()).toEqual(['preview', 'production']);
      expect(config.build.preview?.distribution).toBe('firebase');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--bundle-id / --package-name / --project-type / --ci are respected', () => {
    const dir = makeDir();
    try {
      runInit(dir, [
        '--bundle-id',
        'com.acme.rocket',
        '--package-name',
        'com.acme.rocket.android',
        '--project-type',
        'bare',
        '--ci',
        'gitlab',
      ]);
      const config = yaml.load(readFileSync(join(dir, 'rn-workflows.yml'), 'utf8')) as {
        project: { type: string; bundleId: string; packageName: string };
        ci: string;
      };
      expect(config.project.type).toBe('bare');
      expect(config.project.bundleId).toBe('com.acme.rocket');
      expect(config.project.packageName).toBe('com.acme.rocket.android');
      expect(config.ci).toBe('gitlab');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--distribution and --profiles select build profiles compatible with the distribution', () => {
    const dir = makeDir();
    try {
      // "testflight" requires an iOS-touching platform — "staging" is
      // platform "all", unlike the default "preview" (android-only).
      runInit(dir, ['--distribution', 'testflight', '--profiles', 'staging,production']);
      const config = yaml.load(readFileSync(join(dir, 'rn-workflows.yml'), 'utf8')) as {
        build: Record<string, { platform: string; distribution: string }>;
      };
      expect(Object.keys(config.build).sort()).toEqual(['production', 'staging']);
      expect(config.build.staging?.platform).toBe('all');
      expect(config.build.staging?.distribution).toBe('testflight');
      expect(config.build.production?.distribution).toBe('store');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects an invalid --ci with a clear error and non-zero exit', () => {
    const dir = makeDir();
    try {
      expect(() => runInit(dir, ['--ci', 'nope'])).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects a --distribution incompatible with the selected profiles', () => {
    const dir = makeDir();
    try {
      // default profiles include "preview" (android-only) — testflight needs ios/all.
      expect(() => runInit(dir, ['--distribution', 'testflight'])).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
