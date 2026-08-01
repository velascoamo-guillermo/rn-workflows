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

export interface MatrixWorkflowsDirApp {
  /** App directory relative to the git root (posix separators). */
  dir: string;
  /** The app's `ci.workflowsDir`, when declared. */
  workflowsDir?: string;
}

export interface ResolveMatrixWorkflowsDirInput {
  gitRoot: string;
  /** Value of `--workflows-dir`; wins over everything. */
  flag?: string;
  apps: MatrixWorkflowsDirApp[];
}

export interface MatrixWorkflowsDirResult {
  /** Absolute directory the matrix workflow file is emitted into. */
  dir: string;
  /** Warnings about ignored per-app `ci.workflowsDir` values, for the caller to print. */
  warnings: string[];
}

/**
 * Directory the single `--matrix` workflow file is emitted into.
 *
 * The matrix file is one file shared by N apps, so per-app `ci.workflowsDir`
 * values cannot apply individually. Precedence:
 *   1. `--workflows-dir` flag (resolved against the git root) — wins over everything.
 *   2. Unanimity: when EVERY discovered app declares the SAME `ci.workflowsDir`
 *      value, that value is used (resolved against the git root).
 *   3. Default: `<gitRoot>/.github/workflows`.
 * Divergent or partial declarations fall back to the default with a warning
 * naming the apps whose value was ignored — no merge semantics are invented.
 */
export function resolveMatrixWorkflowsDir(
  input: ResolveMatrixWorkflowsDirInput,
): MatrixWorkflowsDirResult {
  const { gitRoot, flag, apps } = input;
  if (flag) return { dir: resolve(gitRoot, flag), warnings: [] };

  const declared = apps.filter(
    (app): app is MatrixWorkflowsDirApp & { workflowsDir: string } =>
      app.workflowsDir !== undefined,
  );
  if (declared.length === 0) {
    return { dir: join(gitRoot, '.github', 'workflows'), warnings: [] };
  }

  const values = new Set(declared.map((app) => app.workflowsDir));
  if (declared.length === apps.length && values.size === 1) {
    return { dir: resolve(gitRoot, declared[0]!.workflowsDir), warnings: [] };
  }

  const ignored = declared
    .map((app) => `${app.dir === '' ? '.' : app.dir} (${app.workflowsDir})`)
    .join(', ');
  return {
    dir: join(gitRoot, '.github', 'workflows'),
    warnings: [
      `Matrix mode ignores per-app ci.workflowsDir unless every app declares the same value. Ignored: ${ignored}. Using the default <git root>/.github/workflows — pass --workflows-dir to override.`,
    ],
  };
}
