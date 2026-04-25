// src/setup/appstore.ts
import { existsSync } from 'node:fs';
import * as p from '@clack/prompts';
import type { SetupContext, StepResult } from './types.ts';

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

      const teamId = await promptText('Apple Team ID (e.g. ABCD1234)');
      ctx.collectedSecrets['APPLE_TEAM_ID'] = teamId;

      const keyPath = await promptText('Path to App Store Connect API key JSON');
      if (!existsSync(keyPath)) throw new Error(`File not found: ${keyPath}`);
      ctx.collectedSecrets['APP_STORE_CONNECT_API_KEY_PATH'] = keyPath;

      return { skipped: false };
    },
  };
}

async function promptText(message: string): Promise<string> {
  const val = await p.text({ message, validate: v => (v?.trim() ? undefined : 'Required') });
  if (typeof val === 'symbol') { p.cancel('Cancelled.'); process.exit(0); }
  return val;
}
