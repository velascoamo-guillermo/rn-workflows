// src/setup/appstore.ts
import { existsSync, readFileSync } from 'node:fs';
import type { SetupContext, StepResult } from './types.ts';
import { promptText } from './prompts.ts';

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

      const keyPath = await promptText('Path to App Store Connect API key JSON');
      if (!existsSync(keyPath)) throw new Error(`File not found: ${keyPath}`);
      ctx.collectedSecrets['APP_STORE_CONNECT_API_KEY_PATH'] = readFileSync(keyPath, 'utf8');

      return { skipped: false };
    },
  };
}
