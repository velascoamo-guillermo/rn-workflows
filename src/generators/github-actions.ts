import type { Config } from '../config/schema.ts';
import { renderTemplate } from '../utils/render.ts';
import { platformsFor, secretsFor } from '../secrets.ts';
import type { GeneratedFile } from './fastlane.ts';

const DEFAULT_BRANCH: Record<string, string> = {
  preview: 'develop',
  staging: 'staging',
  production: 'main',
};

function branchFor(profileName: string): string {
  return DEFAULT_BRANCH[profileName] ?? 'main';
}

export interface GithubActionsOptions {
  packageManager?: 'yarn' | 'npm' | 'bun';
  /** Directory workflow files are emitted into. Default: `.github/workflows`. */
  workflowsDir?: string;
  /**
   * Posix-relative path from the git root to the app directory.
   * When set (monorepo), workflows get an `on.push.paths` filter scoped to
   * this subdir, per-job `defaults.run.working-directory` on jobs that check
   * out code, and app-dir-aware action inputs (setup-ruby working-directory,
   * setup-node cache-dependency-path, actions/cache paths).
   */
  appDir?: string;
  /** Filename prefix to avoid collisions between apps in the same monorepo. */
  appSlug?: string;
  /**
   * Posix-relative path from the git root to the directory workflow files are
   * emitted into. Used to include each workflow file's own path in its
   * `on.push.paths` filter (so edits to the workflow itself trigger a run).
   * Default: `.github/workflows`.
   */
  workflowsPathFromRoot?: string;
}

export function generateGithubActions(
  config: Config,
  options: GithubActionsOptions = {},
): GeneratedFile[] {
  const packageManager = options.packageManager ?? 'yarn';
  const workflowsDir = options.workflowsDir ?? '.github/workflows';
  const appDir = options.appDir ?? '';
  const slugPrefix = options.appSlug ? `${options.appSlug}-` : '';
  const workflowsPathFromRoot = options.workflowsPathFromRoot ?? '.github/workflows';
  const extraPaths = config.extraPaths ?? [];
  const files: GeneratedFile[] = [];

  for (const [name, profile] of Object.entries(config.build)) {
    const platforms = platformsFor(profile.platform);
    const jobs = platforms.map((platform) => ({
      id: `build-${platform}`,
      name: `Build ${name} (${platform})`,
      platform,
      lane: name,
      runsOn: platform === 'ios' ? 'macos-latest' : 'ubuntu-latest',
      secrets: secretsFor(platform, profile.distribution),
    }));

    const checks = config.checks ?? {};
    const hasChecks = checks.test || checks.lint || checks.typecheck;

    const filename = `rn-${slugPrefix}${name}.yml`;
    const templateData = {
      workflowName: `rn-workflows • ${name}`,
      branch: branchFor(name),
      jobs,
      packageManager,
      checks,
      hasChecks,
      appDir,
      extraPaths,
      selfPath: `${workflowsPathFromRoot}/${filename}`,
    };

    const templateName = profile.ota
      ? 'github/workflow-smart.ejs'
      : 'github/workflow.ejs';

    const content = renderTemplate(templateName, {
      ...templateData,
      ...(profile.ota ? { ota: profile.ota } : {}),
    });

    files.push({ path: `${workflowsDir}/${filename}`, content });
  }

  return files;
}
