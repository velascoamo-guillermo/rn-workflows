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

export function generateGithubActions(
  config: Config,
  options: { packageManager?: 'yarn' | 'npm' | 'bun' } = {},
): GeneratedFile[] {
  const packageManager = options.packageManager ?? 'yarn';
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

    const content = renderTemplate('github/workflow.ejs', {
      workflowName: `rn-workflows • ${name}`,
      branch: branchFor(name),
      jobs,
      packageManager,
    });

    files.push({ path: `.github/workflows/rn-${name}.yml`, content });
  }

  return files;
}
