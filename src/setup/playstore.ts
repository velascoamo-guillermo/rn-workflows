// src/setup/playstore.ts
import { existsSync } from 'node:fs';
import * as p from '@clack/prompts';
import type { SetupContext, StepResult } from './types.ts';

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

      const keyPath = await promptText('Path to Play Store JSON key file');
      if (!existsSync(keyPath)) throw new Error(`File not found: ${keyPath}`);
      ctx.collectedSecrets['PLAY_STORE_JSON_KEY'] = keyPath;

      return { skipped: false };
    },
  };
}

async function promptText(message: string): Promise<string> {
  const val = await p.text({ message, validate: v => (v?.trim() ? undefined : 'Required') });
  if (typeof val === 'symbol') { p.cancel('Cancelled.'); process.exit(0); }
  return val;
}
