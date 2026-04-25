import { describe, expect, it } from 'bun:test';
import { collectRequiredSecrets } from '../src/setup/secrets.ts';
import type { Config } from '../src/config/types.ts';

describe('collectRequiredSecrets', () => {
  it('returns firebase secrets for android firebase profile', () => {
    const config: Config = {
      project: { type: 'expo', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'github-actions',
      build: { staging: { platform: 'android', distribution: 'firebase' } },
    };
    const secrets = collectRequiredSecrets(config);
    expect(secrets).toContain('FIREBASE_APP_ID_ANDROID');
    expect(secrets).toContain('FIREBASE_SERVICE_ACCOUNT_JSON');
    expect(secrets).not.toContain('FIREBASE_APP_ID_IOS');
  });

  it('includes ios signing secrets for ios builds', () => {
    const config: Config = {
      project: { type: 'expo', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'github-actions',
      build: { staging: { platform: 'ios', distribution: 'firebase' } },
    };
    const secrets = collectRequiredSecrets(config);
    expect(secrets).toContain('MATCH_PASSWORD');
    expect(secrets).toContain('MATCH_GIT_URL');
  });

  it('deduplicates secrets across profiles', () => {
    const config: Config = {
      project: { type: 'expo', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'github-actions',
      build: {
        staging: { platform: 'android', distribution: 'firebase' },
        production: { platform: 'android', distribution: 'firebase', android: { buildType: 'aab' } },
      },
    };
    const secrets = collectRequiredSecrets(config);
    expect(secrets.filter(s => s === 'FIREBASE_SERVICE_ACCOUNT_JSON').length).toBe(1);
  });
});
