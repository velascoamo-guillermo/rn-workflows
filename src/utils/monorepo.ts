import { execFileSync } from 'node:child_process';
import { join, relative, resolve, sep } from 'node:path';

/**
 * Absolute path of the git toplevel containing `cwd`, or null when `cwd`
 * is not inside a git work tree (or git is unavailable).
 */
export function findGitRoot(cwd: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const root = out.toString().trim();
    return root.length > 0 ? root : null;
  } catch {
    return null;
  }
}

/** Filename-safe slug: lowercase alphanumerics separated by single dashes. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Relative path from `from` to `to` using posix separators.
 * Empty string when both point at the same directory.
 */
export function toPosixRelative(from: string, to: string): string {
  return relative(from, to).split(sep).join('/');
}

export interface ResolveWorkflowsDirInput {
  cwd: string;
  gitRoot: string | null;
  /** Value of `--workflows-dir`; wins over the config value. */
  flag?: string;
  /** Value of `ci.workflowsDir` from rn-workflows.yml. */
  configValue?: string;
}

/**
 * Directory GitHub workflow files are emitted into.
 * Precedence: flag > config > `<gitRoot>/.github/workflows` > `<cwd>/.github/workflows`.
 * Relative flag/config values resolve against `cwd` (the app directory).
 */
export function resolveWorkflowsDir(input: ResolveWorkflowsDirInput): string {
  const { cwd, gitRoot, flag, configValue } = input;
  if (flag) return resolve(cwd, flag);
  if (configValue) return resolve(cwd, configValue);
  return join(gitRoot ?? cwd, '.github', 'workflows');
}
