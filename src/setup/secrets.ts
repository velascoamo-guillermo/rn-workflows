import * as p from '@clack/prompts';
import type { Config } from '../config/types.ts';
import { deriveRequiredSecrets, secretSetCommand } from '../utils/secrets.ts';
import type { SetupContext, StepResult } from './types.ts';
import { shell, isAvailable } from './shell.ts';

/**
 * Names of every secret `setup` should collect/upload for this config.
 * Delegates entirely to `deriveRequiredSecrets` (src/utils/secrets.ts) —
 * the same derivation the `generate` command and SETUP.md use — so this
 * can never drift into a second, hand-maintained set of names. See
 * tests/setup-secrets.test.ts for the cross-check pinning the two together.
 */
export function collectRequiredSecrets(config: Config): string[] {
  return deriveRequiredSecrets(config).map((s) => s.name);
}

export function makeSecretsStep() {
  return {
    id: 'secrets',
    label: 'Upload CI secrets',
    async run(ctx: SetupContext): Promise<StepResult> {
      // A required secret with no value never blocks the upload of
      // whatever *was* collected — it only downgrades to a printed
      // checklist. `setup` must exit 0 either way: some secrets (e.g.
      // MATCH_GIT_BASIC_AUTHORIZATION) have no interactive collector
      // anywhere in setup/*, so treating them as fatal would make setup
      // unusable for any config that needs one.
      const required = collectRequiredSecrets(ctx.config);
      const missing = required.filter(k => !ctx.collectedSecrets[k]);

      let uploaded = 0;
      let uploadNote: string;

      if (ctx.config.ci === 'github-actions') {
        if (!isAvailable('gh')) {
          throw new Error('gh CLI not found. Install from https://cli.github.com');
        }
        const existing = getExistingGithubSecrets(ctx.githubRepo!);
        for (const [key, value] of Object.entries(ctx.collectedSecrets)) {
          if (existing.has(key)) continue;
          const result = shell('gh', ['secret', 'set', key, '--body', value, '--repo', ctx.githubRepo!]);
          if (result.exitCode !== 0) throw new Error(`gh secret set ${key} failed: ${result.stderr}`);
          uploaded++;
        }
        uploadNote = uploaded > 0 ? `${uploaded} secrets uploaded` : 'all already set';
      } else if (ctx.config.ci === 'gitlab') {
        if (!isAvailable('glab')) {
          throw new Error('glab CLI not found. Install from https://gitlab.com/gitlab-org/cli');
        }
        const existing = getExistingGitlabVariables(ctx.gitlabProjectId!);
        for (const [key, value] of Object.entries(ctx.collectedSecrets)) {
          if (existing.has(key)) continue;
          const result = shell('glab', ['variable', 'set', key, '--value', value, '--repo', ctx.gitlabProjectId!]);
          if (result.exitCode !== 0) throw new Error(`glab variable set ${key} failed: ${result.stderr}`);
          uploaded++;
        }
        uploadNote = uploaded > 0 ? `${uploaded} secrets uploaded` : 'all already set';
      } else {
        throw new Error(`Unsupported CI: ${ctx.config.ci}`);
      }

      if (missing.length === 0) {
        return { skipped: uploaded === 0, note: uploadNote };
      }

      p.log.warn(`${missing.length} required secret(s) were not collected — set them manually:`);
      for (const name of missing) {
        p.log.step(`${secretSetCommand(ctx.config.ci, name)} "<value>"`);
      }

      return {
        skipped: false,
        note: `${uploadNote}; still required: ${missing.join(', ')}`,
      };
    },
  };
}

function getExistingGithubSecrets(repo: string): Set<string> {
  const result = shell('gh', ['secret', 'list', '--repo', repo, '--json', 'name', '--jq', '.[].name']);
  if (result.exitCode !== 0) return new Set();
  return new Set(result.stdout.trim().split('\n').filter(Boolean));
}

function getExistingGitlabVariables(projectId: string): Set<string> {
  const result = shell('glab', ['variable', 'list', '--repo', projectId, '--output', 'json']);
  if (result.exitCode !== 0) return new Set();
  type GlVar = { key: string };
  const vars: GlVar[] = JSON.parse(result.stdout || '[]');
  return new Set(vars.map(v => v.key));
}
