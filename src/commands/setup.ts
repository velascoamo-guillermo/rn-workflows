// src/commands/setup.ts
import { defineCommand } from 'citty';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import * as p from '@clack/prompts';
import { loadConfig, ConfigError } from '../config/parser.ts';
import { runSteps } from '../setup/runner.ts';
import { makeFirebaseAppsStep, makeServiceAccountStep } from '../setup/firebase.ts';
import { makeMatchRepoStep } from '../setup/match.ts';
import { makeSecretsStep } from '../setup/secrets.ts';
import { makeAppCenterStep } from '../setup/appcenter.ts';
import { makeAppStoreStep } from '../setup/appstore.ts';
import { makePlayStoreStep } from '../setup/playstore.ts';
import type { SetupContext } from '../setup/types.ts';
import { isAvailable, shell } from '../setup/shell.ts';

export default defineCommand({
  meta: {
    name: 'setup',
    description: 'Provision Firebase apps, match repo and CI secrets from rn-workflows.yml',
  },
  args: {
    cwd: { type: 'string', description: 'Working directory', default: process.cwd() },
    config: { type: 'string', description: 'Path to rn-workflows.yml', default: 'rn-workflows.yml' },
    'firebase-project': { type: 'string', description: 'Firebase project ID' },
    'github-repo': { type: 'string', description: 'GitHub owner/repo for secrets' },
    'match-repo-name': { type: 'string', description: 'Name for match certificates repo' },
    'dry-run': { type: 'boolean', description: 'Print steps without executing', default: false },
  },
  async run({ args }) {
    p.intro('rn-workflows setup');

    const configPath = resolve(String(args.cwd), String(args.config));
    if (!existsSync(configPath)) {
      p.log.error(`Config not found: ${configPath}`);
      p.log.info('Run `rn-workflows init` first.');
      process.exit(1);
    }

    let config;
    try {
      config = loadConfig(configPath);
    } catch (err) {
      if (err instanceof ConfigError) { p.log.error(err.message); process.exit(1); }
      throw err;
    }

    const ctx: SetupContext = {
      config,
      dryRun: Boolean(args['dry-run']),
      collectedSecrets: {},
    };

    // --- Wizard ---

    if (config.ci === 'github-actions') {
      ctx.githubRepo = args['github-repo']
        ? String(args['github-repo'])
        : String(await p.text({
            message: 'GitHub repo (owner/repo)',
            validate: v => (v && v.includes('/') ? undefined : 'Format: owner/repo'),
          }));
      assertNotCancelled(ctx.githubRepo);
    }

    if (config.ci === 'gitlab') {
      ctx.gitlabProjectId = String(await p.text({ message: 'GitLab project ID or path', validate: v => (v?.trim() ? undefined : 'Required') }));
      assertNotCancelled(ctx.gitlabProjectId);
      ctx.gitlabToken = String(await p.text({ message: 'GitLab personal access token', validate: v => (v?.trim() ? undefined : 'Required') }));
      assertNotCancelled(ctx.gitlabToken);
    }

    const usesFirebase = Object.values(config.build).some(pr => pr.distribution.includes('firebase'));
    if (usesFirebase) {
      if (args['firebase-project']) {
        ctx.firebaseProjectId = String(args['firebase-project']);
      } else {
        ctx.firebaseProjectId = await detectOrPromptFirebaseProject();
      }
    }

    const hasIos = Object.values(config.build).some(pr => pr.platform === 'ios' || pr.platform === 'all');
    if (hasIos) {
      const defaultName = `${config.project.bundleId.split('.').pop()}-match`;
      ctx.matchRepoName = args['match-repo-name']
        ? String(args['match-repo-name'])
        : String(await p.text({
            message: 'Match repo name',
            placeholder: defaultName,
            defaultValue: defaultName,
          }));
      assertNotCancelled(ctx.matchRepoName);

      const pw = String(await p.password({ message: 'Match encryption password (MATCH_PASSWORD)' }));
      assertNotCancelled(pw);
      ctx.collectedSecrets['MATCH_PASSWORD'] = pw;
    }

    // --- Steps ---
    await runSteps([
      makeFirebaseAppsStep(),
      makeServiceAccountStep(),
      makeMatchRepoStep(),
      makeAppCenterStep(),
      makeAppStoreStep(),
      makePlayStoreStep(),
      makeSecretsStep(),
    ], ctx);

    // --- Summary ---
    p.log.success('Setup complete!');
    if (hasIos) {
      p.log.warn('Next: seed match certificates manually:');
      p.log.info('  MATCH_READONLY=false bundle exec fastlane match adhoc');
    }

    p.outro('Done.');
  },
});

async function detectOrPromptFirebaseProject(): Promise<string> {
  if (isAvailable('firebase')) {
    const result = shell('firebase', ['projects:list', '--json']);
    if (result.exitCode === 0) {
      type FbProject = { projectId: string; displayName: string };
      const projects: FbProject[] = JSON.parse(result.stdout || '[]').result ?? [];
      if (projects.length === 1) return projects[0].projectId;
      if (projects.length > 1) {
        const chosen = await p.select({
          message: 'Select Firebase project',
          options: projects.map(pr => ({ value: pr.projectId, label: `${pr.displayName} (${pr.projectId})` })),
        });
        assertNotCancelled(chosen);
        return String(chosen);
      }
    }
  }
  const id = await p.text({ message: 'Firebase project ID', validate: v => (v?.trim() ? undefined : 'Required') });
  assertNotCancelled(id);
  return String(id);
}

function assertNotCancelled(value: unknown): asserts value {
  if (typeof value === 'symbol') { p.cancel('Cancelled.'); process.exit(0); }
}
