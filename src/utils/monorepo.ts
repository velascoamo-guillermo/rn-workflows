import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/** Config filename scanned for by `discoverConfigs`. */
export const CONFIG_FILENAME = 'rn-workflows.yml';

/**
 * Absolute paths of every `rn-workflows.yml` under `root`, sorted for
 * deterministic output. Skips `node_modules` and dot-directories.
 */
export function discoverConfigs(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable dir — skip
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(join(dir, entry.name));
      } else if (entry.isFile() && entry.name === CONFIG_FILENAME) {
        found.push(join(dir, entry.name));
      }
    }
  };
  walk(root);
  return found.sort();
}

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
