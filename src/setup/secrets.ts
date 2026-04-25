import type { Config } from '../config/types.ts';
import { secretsFor, platformsFor } from '../secrets.ts';
import type { SetupContext, StepResult } from './types.ts';
import { shell, isAvailable } from './shell.ts';

export function collectRequiredSecrets(config: Config): string[] {
  const set = new Set<string>();
  for (const profile of Object.values(config.build)) {
    for (const platform of platformsFor(profile.platform)) {
      for (const s of secretsFor(platform, profile.distribution)) {
        set.add(s);
      }
    }
  }
  return [...set].sort();
}

export function makeSecretsStep() {
  return {
    id: 'secrets',
    label: 'Upload CI secrets',
    async run(ctx: SetupContext): Promise<StepResult> {
      const required = collectRequiredSecrets(ctx.config);
      const missing = required.filter(k => !ctx.collectedSecrets[k]);
      if (missing.length > 0) {
        throw new Error(`Missing values for secrets: ${missing.join(', ')}`);
      }

      if (ctx.config.ci === 'github-actions') {
        if (!isAvailable('gh')) {
          throw new Error('gh CLI not found. Install from https://cli.github.com');
        }
        const existing = getExistingGithubSecrets(ctx.githubRepo!);
        let uploaded = 0;
        for (const [key, value] of Object.entries(ctx.collectedSecrets)) {
          if (existing.has(key)) continue;
          const result = shell('gh', ['secret', 'set', key, '--body', value, '--repo', ctx.githubRepo!]);
          if (result.exitCode !== 0) throw new Error(`gh secret set ${key} failed: ${result.stderr}`);
          uploaded++;
        }
        return { skipped: uploaded === 0, note: uploaded > 0 ? `${uploaded} secrets uploaded` : 'all already set' };
      }

      if (ctx.config.ci === 'gitlab') {
        let uploaded = 0;
        for (const [key, value] of Object.entries(ctx.collectedSecrets)) {
          const res = await setGitlabVariable(ctx.gitlabProjectId!, ctx.gitlabToken!, key, value);
          if (res) uploaded++;
        }
        return { skipped: uploaded === 0, note: `${uploaded} secrets uploaded` };
      }

      throw new Error(`Unsupported CI: ${ctx.config.ci}`);
    },
  };
}

function getExistingGithubSecrets(repo: string): Set<string> {
  const result = shell('gh', ['secret', 'list', '--repo', repo, '--json', 'name', '--jq', '.[].name']);
  if (result.exitCode !== 0) return new Set();
  return new Set(result.stdout.trim().split('\n').filter(Boolean));
}

async function setGitlabVariable(projectId: string, token: string, key: string, value: string): Promise<boolean> {
  const url = `https://gitlab.com/api/v4/projects/${encodeURIComponent(projectId)}/variables`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value, protected: false, masked: true }),
  });
  return res.ok;
}
