// src/setup/match.ts
import { shell, isAvailable } from './shell.ts';
import type { SetupContext, StepResult } from './types.ts';

export function makeMatchRepoStep() {
  return {
    id: 'match-repo',
    label: 'Create match certificates repo',
    run(ctx: SetupContext): StepResult {
      const hasIos = Object.values(ctx.config.build).some(
        p => p.platform === 'ios' || p.platform === 'all',
      );
      if (!hasIos) return { skipped: true, note: 'no iOS builds' };

      const repoName = ctx.matchRepoName!.replace(/^https?:\/\/[^/]+\//, '').replace(/\.git$/, '');

      if (ctx.config.ci === 'github-actions') {
        if (!isAvailable('gh')) throw new Error('gh CLI not found. Install from https://cli.github.com');

        const check = shell('gh', ['repo', 'view', repoName]);
        if (check.exitCode === 0) {
          const owner = repoName.includes('/') ? repoName.split('/')[0] : ctx.githubRepo!.split('/')[0];
          const fullName = repoName.includes('/') ? repoName : `${owner}/${repoName}`;
          ctx.collectedSecrets['MATCH_GIT_URL'] = `https://github.com/${fullName}.git`;
          return { skipped: true, note: 'repo already exists' };
        }

        const fullName = repoName.includes('/') ? repoName : `${ctx.githubRepo!.split('/')[0]}/${repoName}`;
        const r = shell('gh', ['repo', 'create', fullName, '--private', '--description', 'Fastlane Match certificates']);
        if (r.exitCode !== 0) throw new Error(`gh repo create failed: ${r.stderr}`);
        ctx.collectedSecrets['MATCH_GIT_URL'] = `https://github.com/${fullName}.git`;
        return { skipped: false, note: fullName };
      }

      if (ctx.config.ci === 'gitlab') {
        if (!isAvailable('glab')) throw new Error('glab CLI not found. Install from https://gitlab.com/gitlab-org/cli');

        const check = shell('glab', ['repo', 'view', repoName]);
        if (check.exitCode === 0) {
          const urlLine = check.stdout.split('\n').find(l => l.includes('http'));
          ctx.collectedSecrets['MATCH_GIT_URL'] = urlLine?.trim() ?? `https://gitlab.com/${repoName}.git`;
          return { skipped: true, note: 'repo already exists' };
        }

        const r = shell('glab', ['repo', 'create', repoName, '--private', '--description', 'Fastlane Match certificates', '--defaultBranch', 'main']);
        if (r.exitCode !== 0) throw new Error(`glab repo create failed: ${r.stderr}`);
        ctx.collectedSecrets['MATCH_GIT_URL'] = `https://gitlab.com/${repoName}.git`;
        return { skipped: false, note: repoName };
      }

      throw new Error(`Unsupported CI: ${ctx.config.ci}`);
    },
  };
}
