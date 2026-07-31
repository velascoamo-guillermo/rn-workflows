import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import {
  findGitRoot,
  resolveWorkflowsDir,
  slugify,
  toPosixRelative,
} from '../src/utils/monorepo';

describe('resolveWorkflowsDir', () => {
  const cwd = '/repo/apps/mobile';
  const gitRoot = '/repo';

  test('defaults to <gitRoot>/.github/workflows', () => {
    expect(resolveWorkflowsDir({ cwd, gitRoot })).toBe('/repo/.github/workflows');
  });

  test('falls back to <cwd>/.github/workflows when no git root', () => {
    expect(resolveWorkflowsDir({ cwd, gitRoot: null })).toBe(
      '/repo/apps/mobile/.github/workflows',
    );
  });

  test('config value overrides the git-root default (resolved against cwd)', () => {
    expect(
      resolveWorkflowsDir({ cwd, gitRoot, configValue: 'ci/workflows' }),
    ).toBe('/repo/apps/mobile/ci/workflows');
  });

  test('flag wins over config value', () => {
    expect(
      resolveWorkflowsDir({
        cwd,
        gitRoot,
        configValue: 'ci/workflows',
        flag: '../../custom-workflows',
      }),
    ).toBe('/repo/custom-workflows');
  });

  test('absolute flag is used as-is', () => {
    expect(
      resolveWorkflowsDir({ cwd, gitRoot, flag: '/elsewhere/workflows' }),
    ).toBe('/elsewhere/workflows');
  });
});

describe('slugify', () => {
  test('lowercases and keeps alphanumerics', () => {
    expect(slugify('mobile')).toBe('mobile');
    expect(slugify('MyApp')).toBe('myapp');
  });

  test('replaces separators with dashes and trims', () => {
    expect(slugify('My App_v2')).toBe('my-app-v2');
    expect(slugify('--weird--')).toBe('weird');
  });
});

describe('toPosixRelative', () => {
  test('returns empty string when paths are equal', () => {
    expect(toPosixRelative('/repo', '/repo')).toBe('');
  });

  test('returns posix relative path for nested dir', () => {
    expect(toPosixRelative('/repo', '/repo/apps/mobile')).toBe('apps/mobile');
  });
});

describe('findGitRoot', () => {
  test('finds the toplevel from a nested directory', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'rnwf-git-'));
    try {
      execSync('git init -q', { cwd: tmp });
      const nested = join(tmp, 'apps', 'mobile');
      mkdirSync(nested, { recursive: true });
      const root = findGitRoot(nested);
      // macOS tmpdir may be a symlink (/var -> /private/var); compare realpaths.
      expect(root && resolve(execSync('git rev-parse --show-toplevel', { cwd: nested }).toString().trim())).toBe(root);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('returns null outside a git repo', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'rnwf-nogit-'));
    try {
      expect(findGitRoot(tmp)).toBeNull();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
