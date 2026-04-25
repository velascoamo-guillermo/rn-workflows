// src/setup/firebase.ts
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync, readFileSync } from 'node:fs';
import { shell, isAvailable } from './shell.ts';
import type { SetupContext, StepResult } from './types.ts';
import { promptText } from './prompts.ts';

export function makeFirebaseAppsStep() {
  return {
    id: 'firebase-apps',
    label: 'Create Firebase apps',
    async run(ctx: SetupContext): Promise<StepResult> {
      const { bundleId, packageName } = ctx.config.project;
      const projectId = ctx.firebaseProjectId!;

      const usesFirebase = Object.values(ctx.config.build).some(pr =>
        pr.distribution.includes('firebase'),
      );
      if (!usesFirebase) {
        return { skipped: true, note: 'no firebase distribution' };
      }

      const needsAndroid = Object.values(ctx.config.build).some(
        pr => pr.distribution.includes('firebase') && (pr.platform === 'android' || pr.platform === 'all'),
      );
      const needsIos = Object.values(ctx.config.build).some(
        pr => pr.distribution.includes('firebase') && (pr.platform === 'ios' || pr.platform === 'all'),
      );

      if (!isAvailable('firebase')) {
        if (needsAndroid) {
          ctx.collectedSecrets['FIREBASE_APP_ID_ANDROID'] = await promptText('Firebase App ID (Android)');
        }
        if (needsIos) {
          ctx.collectedSecrets['FIREBASE_APP_ID_IOS'] = await promptText('Firebase App ID (iOS)');
        }
        return { skipped: false, note: 'entered manually (firebase CLI not found)' };
      }

      const listResult = shell('firebase', ['apps:list', '--project', projectId, '--json']);
      type FbApp = { appId: string; platform: string; namespace?: string };
      const apps: FbApp[] = JSON.parse(listResult.stdout || '[]').result ?? [];

      const hasAndroid = apps.some(a => a.platform === 'ANDROID' && a.namespace === packageName);
      const hasIos = apps.some(a => a.platform === 'IOS' && a.namespace === bundleId);

      if (needsAndroid && !hasAndroid) {
        const r = shell('firebase', ['apps:create', 'ANDROID', '--package-name', packageName, '--project', projectId]);
        if (r.exitCode !== 0) throw new Error(`Failed to create Android app: ${r.stderr}`);
      }
      if (needsIos && !hasIos) {
        const r = shell('firebase', ['apps:create', 'IOS', '--bundle-id', bundleId, '--project', projectId]);
        if (r.exitCode !== 0) throw new Error(`Failed to create iOS app: ${r.stderr}`);
      }

      const updated = shell('firebase', ['apps:list', '--project', projectId, '--json']);
      const updatedApps: FbApp[] = JSON.parse(updated.stdout || '[]').result ?? [];

      if (needsAndroid) {
        const androidApp = updatedApps.find(a => a.platform === 'ANDROID' && a.namespace === packageName);
        if (androidApp) ctx.collectedSecrets['FIREBASE_APP_ID_ANDROID'] = androidApp.appId;
      }
      if (needsIos) {
        const iosApp = updatedApps.find(a => a.platform === 'IOS' && a.namespace === bundleId);
        if (iosApp) ctx.collectedSecrets['FIREBASE_APP_ID_IOS'] = iosApp.appId;
      }

      return {
        skipped: (!needsAndroid || hasAndroid) && (!needsIos || hasIos),
        note: (!needsAndroid || hasAndroid) && (!needsIos || hasIos) ? 'already existed' : 'created',
      };
    },
  };
}

export function makeServiceAccountStep() {
  return {
    id: 'service-account',
    label: 'Generate Firebase service account',
    async run(ctx: SetupContext): Promise<StepResult> {
      const usesFirebase = Object.values(ctx.config.build).some(pr =>
        pr.distribution.includes('firebase'),
      );
      if (!usesFirebase) {
        return { skipped: true, note: 'no firebase distribution' };
      }

      if (ctx.collectedSecrets['FIREBASE_SERVICE_ACCOUNT_JSON']) {
        return { skipped: true, note: 'already collected' };
      }

      if (!isAvailable('gcloud')) {
        const json = await promptText('Paste Firebase service account JSON');
        ctx.collectedSecrets['FIREBASE_SERVICE_ACCOUNT_JSON'] = json;
        return { skipped: false, note: 'entered manually (gcloud not found)' };
      }

      const projectId = ctx.firebaseProjectId!;
      const saResult = shell('gcloud', [
        'iam', 'service-accounts', 'list',
        `--project=${projectId}`,
        '--format=value(email)',
        '--filter=displayName~firebase-adminsdk',
      ]);
      const saEmail = saResult.stdout.trim().split('\n').find(e => e.includes('firebase-adminsdk'));
      if (!saEmail) throw new Error('firebase-adminsdk service account not found. Enable Firebase in your project.');

      const tmpPath = join(tmpdir(), `rn-workflows-sa-${Date.now()}.json`);
      const r = shell('gcloud', [
        'iam', 'service-accounts', 'keys', 'create', tmpPath,
        `--iam-account=${saEmail}`,
        `--project=${projectId}`,
      ]);
      if (r.exitCode !== 0) throw new Error(`gcloud key create failed: ${r.stderr}`);

      let json: string;
      try {
        json = readFileSync(tmpPath, 'utf8');
      } finally {
        try { unlinkSync(tmpPath); } catch { /* file may not exist */ }
      }
      ctx.collectedSecrets['FIREBASE_SERVICE_ACCOUNT_JSON'] = json!;

      return { skipped: false, note: 'key created and collected' };
    },
  };
}
