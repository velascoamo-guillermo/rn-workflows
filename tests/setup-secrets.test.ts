import { describe, expect, it } from 'bun:test';
import { collectRequiredSecrets } from '../src/setup/secrets.ts';
import { deriveRequiredSecrets } from '../src/utils/secrets.ts';
import type { Config } from '../src/config/types.ts';

describe('collectRequiredSecrets', () => {
  it('is the same single source of truth as deriveRequiredSecrets — no parallel name table (#34)', () => {
    // Regression guard for the pre-fix duplication: this file used to
    // rebuild the android/ios secret sets itself instead of delegating to
    // `deriveRequiredSecrets` (src/utils/secrets.ts), so template-layer
    // extras like MATCH_GIT_BASIC_AUTHORIZATION/OTA_UPLOAD_KEY silently
    // never showed up here even though they're part of what CI actually
    // needs. Pin the two outputs together so they can't drift again.
    const config: Config = {
      project: { type: 'bare', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'github-actions',
      build: {
        production: {
          platform: 'ios',
          distribution: 'testflight',
          ota: { server: 'https://ota.example.com', channel: 'production' },
        },
      },
    };
    expect(collectRequiredSecrets(config)).toEqual(
      deriveRequiredSecrets(config).map((s) => s.name).sort(),
    );
  });

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
