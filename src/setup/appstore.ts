// src/setup/appstore.ts
import { existsSync, readFileSync } from 'node:fs';
import type { SetupContext, StepResult } from './types.ts';
import { promptText, promptConfirm } from './prompts.ts';

/**
 * Every secret name `run()` below ever assigns into `ctx.collectedSecrets`.
 * Kept as the declared source of truth for what this step collects so
 * tests (tests/setup-appstore.test.ts) can pin against it directly instead
 * of reconstructing the set with a name-prefix filter over
 * `collectRequiredSecrets` — that filter went stale the moment
 * ASC_KEY_IS_BASE64 became optional (#34 review) and so was excluded from
 * "required" while this step still (correctly) collects it regardless.
 */
export const APP_STORE_STEP_SECRET_NAMES = [
  'APPLE_TEAM_ID',
  'ASC_KEY_ID',
  'ASC_ISSUER_ID',
  'ASC_KEY_CONTENT',
  'ASC_KEY_IS_BASE64',
] as const;

export function makeAppStoreStep() {
  return {
    id: 'appstore',
    label: 'Configure App Store Connect',
    async run(ctx: SetupContext): Promise<StepResult> {
      const needsAppStore = Object.values(ctx.config.build).some(pr => {
        const dists = pr.distribution.split('+');
        const hasIos = pr.platform === 'ios' || pr.platform === 'all';
        return hasIos && (dists.includes('store') || dists.includes('testflight'));
      });
      if (!needsAppStore) return { skipped: true, note: 'not used' };

      if (ctx.collectedSecrets['APPLE_TEAM_ID']) {
        return { skipped: true, note: 'already collected' };
      }

      const teamId = await promptText('Apple Team ID (e.g. ABCD1234)');
      ctx.collectedSecrets['APPLE_TEAM_ID'] = teamId;

      ctx.collectedSecrets['ASC_KEY_ID'] = await promptText('App Store Connect API key ID');
      ctx.collectedSecrets['ASC_ISSUER_ID'] = await promptText('App Store Connect API issuer ID');

      const keyPath = await promptText('Path to the downloaded .p8 App Store Connect API key file');
      if (!existsSync(keyPath)) throw new Error(`File not found: ${keyPath}`);
      const keyContent = readFileSync(keyPath, 'utf8');

      // The .p8 is a multiline PEM file. Most CI secret stores can mask a
      // single-line value but not a multiline one (GitLab in particular) —
      // base64-encoding collapses it to one line so it can be masked.
      const useBase64 = await promptConfirm(
        'Store the key as base64? (recommended for GitLab — multiline secrets cannot be masked there)',
      );
      ctx.collectedSecrets['ASC_KEY_CONTENT'] = useBase64
        ? Buffer.from(keyContent, 'utf8').toString('base64')
        : keyContent;
      ctx.collectedSecrets['ASC_KEY_IS_BASE64'] = useBase64 ? 'true' : 'false';

      return { skipped: false };
    },
  };
}
