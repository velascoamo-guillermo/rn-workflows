// src/setup/appcenter.ts
import * as p from '@clack/prompts';
import type { SetupContext, StepResult } from './types.ts';

export function makeAppCenterStep() {
  return {
    id: 'appcenter',
    label: 'Configure AppCenter',
    async run(ctx: SetupContext): Promise<StepResult> {
      const usesAppCenter = Object.values(ctx.config.build).some(pr =>
        pr.distribution.includes('appcenter'),
      );
      if (!usesAppCenter) return { skipped: true, note: 'not used' };

      const token = await promptText('AppCenter API token');
      const owner = await promptText('AppCenter owner name');

      const hasAndroid = Object.values(ctx.config.build).some(
        pr => pr.distribution.includes('appcenter') && (pr.platform === 'android' || pr.platform === 'all'),
      );
      const hasIos = Object.values(ctx.config.build).some(
        pr => pr.distribution.includes('appcenter') && (pr.platform === 'ios' || pr.platform === 'all'),
      );

      ctx.collectedSecrets['APPCENTER_API_TOKEN'] = token;
      ctx.collectedSecrets['APPCENTER_OWNER_NAME'] = owner;
      if (hasAndroid) ctx.collectedSecrets['APPCENTER_APP_NAME_ANDROID'] = await promptText('AppCenter Android app name');
      if (hasIos) ctx.collectedSecrets['APPCENTER_APP_NAME_IOS'] = await promptText('AppCenter iOS app name');

      return { skipped: false };
    },
  };
}

async function promptText(message: string): Promise<string> {
  const val = await p.text({ message, validate: v => (v?.trim() ? undefined : 'Required') });
  if (typeof val === 'symbol') { p.cancel('Cancelled.'); process.exit(0); }
  return val;
}
