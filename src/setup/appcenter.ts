// src/setup/appcenter.ts
import type { SetupContext, StepResult } from './types.ts';
import { promptText } from './prompts.ts';

export function makeAppCenterStep() {
  return {
    id: 'appcenter',
    label: 'Configure AppCenter',
    async run(ctx: SetupContext): Promise<StepResult> {
      const usesAppCenter = Object.values(ctx.config.build).some(pr =>
        pr.distribution.includes('appcenter'),
      );
      if (!usesAppCenter) return { skipped: true, note: 'not used' };

      if (ctx.collectedSecrets['APPCENTER_API_TOKEN']) {
        return { skipped: true, note: 'already collected' };
      }

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
