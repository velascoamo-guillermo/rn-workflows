// src/setup/playstore.ts
import { existsSync, readFileSync } from 'node:fs';
import type { SetupContext, StepResult } from './types.ts';
import { promptText } from './prompts.ts';

export function makePlayStoreStep() {
  return {
    id: 'playstore',
    label: 'Configure Play Store',
    async run(ctx: SetupContext): Promise<StepResult> {
      const needsPlayStore = Object.values(ctx.config.build).some(pr => {
        const dists = pr.distribution.split('+');
        const hasAndroid = pr.platform === 'android' || pr.platform === 'all';
        return hasAndroid && dists.includes('store');
      });
      if (!needsPlayStore) return { skipped: true, note: 'not used' };

      if (ctx.collectedSecrets['PLAY_STORE_JSON_KEY']) {
        return { skipped: true, note: 'already collected' };
      }

      const keyPath = await promptText('Path to Play Store JSON key file');
      if (!existsSync(keyPath)) throw new Error(`File not found: ${keyPath}`);
      ctx.collectedSecrets['PLAY_STORE_JSON_KEY'] = readFileSync(keyPath, 'utf8');

      return { skipped: false };
    },
  };
}
