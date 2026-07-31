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
   * When set (monorepo), workflows get `defaults.run.working-directory`
   * and an `on.push.paths` filter scoped to this subdir.
   */
  appDir?: string;
  /** Filename prefix to avoid collisions between apps in the same monorepo. */
  appSlug?: string;
}

export function generateGithubActions(
  config: Config,
  options: GithubActionsOptions = {},
): GeneratedFile[] {
  const packageManager = options.packageManager ?? 'yarn';
  const workflowsDir = options.workflowsDir ?? '.github/workflows';
  const appDir = options.appDir ?? '';
  const slugPrefix = options.appSlug ? `${options.appSlug}-` : '';
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

    const templateData = {
      workflowName: `rn-workflows • ${name}`,
      branch: branchFor(name),
      jobs,
      packageManager,
      checks,
      hasChecks,
      appDir,
    };

    const templateName = profile.ota
      ? 'github/workflow-smart.ejs'
      : 'github/workflow.ejs';

    const content = renderTemplate(templateName, {
      ...templateData,
      ...(profile.ota ? { ota: profile.ota } : {}),
    });

    files.push({ path: `${workflowsDir}/rn-${slugPrefix}${name}.yml`, content });
  }

  return files;
}
