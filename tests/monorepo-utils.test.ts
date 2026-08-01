import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import {
  assignUniqueSlugs,
  findGitRoot,
  resolveMatrixWorkflowsDir,
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

describe('resolveMatrixWorkflowsDir', () => {
  const gitRoot = '/repo';

  test('defaults to <gitRoot>/.github/workflows when no app declares ci.workflowsDir', () => {
    const result = resolveMatrixWorkflowsDir({
      gitRoot,
      apps: [{ dir: 'apps/a' }, { dir: 'apps/b' }],
    });
    expect(result.dir).toBe('/repo/.github/workflows');
    expect(result.warnings).toEqual([]);
  });

  test('unanimity: all apps declaring the SAME value uses it (resolved against gitRoot)', () => {
    const result = resolveMatrixWorkflowsDir({
      gitRoot,
      apps: [
        { dir: 'apps/a', workflowsDir: 'ci/workflows' },
        { dir: 'apps/b', workflowsDir: 'ci/workflows' },
      ],
    });
    expect(result.dir).toBe('/repo/ci/workflows');
    expect(result.warnings).toEqual([]);
  });

  test('divergent values fall back to the default and warn naming the apps', () => {
    const result = resolveMatrixWorkflowsDir({
      gitRoot,
      apps: [
        { dir: 'apps/a', workflowsDir: 'ci/workflows' },
        { dir: 'apps/b', workflowsDir: 'other/workflows' },
      ],
    });
    expect(result.dir).toBe('/repo/.github/workflows');
    expect(result.warnings).toHaveLength(1);
    const warning = result.warnings[0]!;
    expect(warning).toContain('apps/a');
    expect(warning).toContain('apps/b');
    expect(warning).toContain('--workflows-dir');
  });

  test('partial declaration (not ALL apps) falls back to the default and warns', () => {
    const result = resolveMatrixWorkflowsDir({
      gitRoot,
      apps: [{ dir: 'apps/a', workflowsDir: 'ci/workflows' }, { dir: 'apps/b' }],
    });
    expect(result.dir).toBe('/repo/.github/workflows');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('apps/a');
    expect(result.warnings[0]).toContain('--workflows-dir');
  });

  test('flag wins over a unanimous value (resolved against gitRoot), no warning', () => {
    const result = resolveMatrixWorkflowsDir({
      gitRoot,
      flag: 'custom-workflows',
      apps: [
        { dir: 'apps/a', workflowsDir: 'ci/workflows' },
        { dir: 'apps/b', workflowsDir: 'ci/workflows' },
      ],
    });
    expect(result.dir).toBe('/repo/custom-workflows');
    expect(result.warnings).toEqual([]);
  });

  test('flag wins over divergent values, no warning', () => {
    const result = resolveMatrixWorkflowsDir({
      gitRoot,
      flag: '/elsewhere/workflows',
      apps: [
        { dir: 'apps/a', workflowsDir: 'ci/workflows' },
        { dir: 'apps/b', workflowsDir: 'other/workflows' },
      ],
    });
    expect(result.dir).toBe('/elsewhere/workflows');
    expect(result.warnings).toEqual([]);
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

describe('assignUniqueSlugs', () => {
  test('keeps basename-derived slugs when unique across apps', () => {
    expect(
      assignUniqueSlugs([
        { dir: 'apps/pawlog', baseSlug: 'pawlog' },
        { dir: 'apps/vaulty', baseSlug: 'vaulty' },
      ]),
    ).toEqual(['pawlog', 'vaulty']);
  });

  test('falls back to path-derived slugs on basename collision', () => {
    expect(
      assignUniqueSlugs([
        { dir: 'apps/a/mobile', baseSlug: 'mobile' },
        { dir: 'apps/b/mobile', baseSlug: 'mobile' },
      ]),
    ).toEqual(['apps-a-mobile', 'apps-b-mobile']);
  });

  test('root-level app keeps its base slug during collision fallback', () => {
    expect(
      assignUniqueSlugs([
        { dir: '', baseSlug: 'mobile' },
        { dir: 'apps/mobile', baseSlug: 'mobile' },
      ]),
    ).toEqual(['mobile', 'apps-mobile']);
  });

  test('throws naming the colliding dirs when path-derived slugs still collide', () => {
    expect(() =>
      assignUniqueSlugs([
        { dir: 'apps/a-b', baseSlug: 'a-b' },
        { dir: 'apps/a_b', baseSlug: 'a-b' },
      ]),
    ).toThrow(/apps\/a-b.*apps\/a_b|apps-a-b/);
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
