// src/setup/match.ts
import { shell, isAvailable } from './shell.ts';
import type { SetupContext, StepResult } from './types.ts';

export function makeMatchRepoStep() {
  return {
    id: 'match-repo',
    label: 'Create match certificates repo',
    async run(ctx: SetupContext): Promise<StepResult> {
      const hasIos = Object.values(ctx.config.build).some(
        p => p.platform === 'ios' || p.platform === 'all',
      );
      if (!hasIos) return { skipped: true, note: 'no iOS builds' };

      const repoName = ctx.matchRepoName!;

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
        // Check if project exists first
        const checkUrl = `https://gitlab.com/api/v4/projects/${encodeURIComponent(repoName)}`;
        const checkRes = await fetch(checkUrl, {
          headers: { 'PRIVATE-TOKEN': ctx.gitlabToken! },
        });
        if (checkRes.ok) {
          const existing = await checkRes.json() as { http_url_to_repo: string };
          ctx.collectedSecrets['MATCH_GIT_URL'] = existing.http_url_to_repo;
          return { skipped: true, note: 'repo already exists' };
        }

        const res = await fetch('https://gitlab.com/api/v4/projects', {
          method: 'POST',
          headers: { 'PRIVATE-TOKEN': ctx.gitlabToken!, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: repoName, visibility: 'private' }),
        });
        if (!res.ok) throw new Error(`GitLab project create failed: ${await res.text()}`);
        const data = await res.json() as { http_url_to_repo: string };
        ctx.collectedSecrets['MATCH_GIT_URL'] = data.http_url_to_repo;
        return { skipped: false, note: repoName };
      }

      throw new Error(`Unsupported CI: ${ctx.config.ci}`);
    },
  };
}
