import { describe, expect, it } from 'bun:test';
import { buildSetupMarkdown, deriveRequiredSecrets, secretSetCommand } from '../src/utils/secrets.ts';
import type { Config } from '../src/config/types.ts';

function names(config: Config): string[] {
  return deriveRequiredSecrets(config).map((s) => s.name);
}

describe('deriveRequiredSecrets', () => {
  it('testflight-only (ios): App Store Connect key + match signing secrets', () => {
    const config: Config = {
      project: { type: 'bare', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'github-actions',
      build: { production: { platform: 'ios', distribution: 'testflight' } },
    };
    expect(names(config).sort()).toEqual(
      [
        'APPLE_TEAM_ID',
        'ASC_KEY_ID',
        'ASC_ISSUER_ID',
        'ASC_KEY_CONTENT',
        'ASC_KEY_IS_BASE64',
        'MATCH_GIT_BASIC_AUTHORIZATION',
        'MATCH_GIT_URL',
        'MATCH_PASSWORD',
      ].sort(),
    );
  });

  it('firebase-only (android): firebase app distribution secrets', () => {
    const config: Config = {
      project: { type: 'bare', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'github-actions',
      build: { staging: { platform: 'android', distribution: 'firebase' } },
    };
    expect(names(config).sort()).toEqual(
      ['FIREBASE_APP_ID_ANDROID', 'FIREBASE_SERVICE_ACCOUNT_JSON'].sort(),
    );
  });

  it('combined (all platforms, testflight+firebase): union of both platforms secrets', () => {
    const config: Config = {
      project: { type: 'bare', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'github-actions',
      build: { staging: { platform: 'all', distribution: 'testflight+firebase' } },
    };
    expect(names(config).sort()).toEqual(
      [
        'APPLE_TEAM_ID',
        'ASC_KEY_ID',
        'ASC_ISSUER_ID',
        'ASC_KEY_CONTENT',
        'ASC_KEY_IS_BASE64',
        'FIREBASE_APP_ID_ANDROID',
        'FIREBASE_APP_ID_IOS',
        'FIREBASE_SERVICE_ACCOUNT_JSON',
        'MATCH_GIT_BASIC_AUTHORIZATION',
        'MATCH_GIT_URL',
        'MATCH_PASSWORD',
      ].sort(),
    );
  });

  it('ota profile adds OTA_UPLOAD_KEY on top of distribution secrets', () => {
    const config: Config = {
      project: { type: 'bare', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'github-actions',
      build: {
        production: {
          platform: 'android',
          distribution: 'store',
          ota: { server: 'https://ota.example.com', channel: 'production' },
        },
      },
    };
    expect(names(config).sort()).toEqual(['OTA_UPLOAD_KEY', 'PLAY_STORE_JSON_KEY'].sort());
  });

  it('android github-releases distribution requires GITHUB_TOKEN (rendered as a job secret)', () => {
    const config: Config = {
      project: { type: 'bare', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'github-actions',
      build: { staging: { platform: 'android', distribution: 'github-releases' } },
    };
    expect(names(config)).toEqual(['GITHUB_TOKEN']);
  });

  it('a target with no rendered secrets requires zero (out-of-schema android+testflight, since the CLI rejects that combo)', () => {
    const config: Config = {
      project: { type: 'bare', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'github-actions',
      build: { staging: { platform: 'android', distribution: 'testflight' } },
    };
    expect(deriveRequiredSecrets(config)).toEqual([]);
  });

  it('dedupes secrets shared across profiles', () => {
    const config: Config = {
      project: { type: 'bare', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'github-actions',
      build: {
        staging: { platform: 'android', distribution: 'firebase' },
        production: { platform: 'android', distribution: 'firebase' },
      },
    };
    expect(names(config).filter((n) => n === 'FIREBASE_SERVICE_ACCOUNT_JSON')).toHaveLength(1);
  });

  it('every requirement carries a human description', () => {
    const config: Config = {
      project: { type: 'bare', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'github-actions',
      build: { staging: { platform: 'android', distribution: 'firebase' } },
    };
    for (const req of deriveRequiredSecrets(config)) {
      expect(req.description.length).toBeGreaterThan(0);
    }
  });

  // #34 review — Important: ASC_KEY_IS_BASE64 was wired as mandatory, but
  // it's a flag with a false-y default (the Fastfile reads
  // `ENV["ASC_KEY_IS_BASE64"] == "true"`), not a value CI can't run
  // without. It stays in the returned set (env blocks render it
  // unconditionally) but is flagged optional so downstream "required"
  // consumers can exclude it.
  it('marks ASC_KEY_IS_BASE64 optional; every other ios/testflight secret stays required', () => {
    const config: Config = {
      project: { type: 'bare', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'github-actions',
      build: { production: { platform: 'ios', distribution: 'testflight' } },
    };
    const secrets = deriveRequiredSecrets(config);
    const base64Flag = secrets.find((s) => s.name === 'ASC_KEY_IS_BASE64');
    expect(base64Flag?.optional).toBe(true);

    const others = secrets.filter((s) => s.name !== 'ASC_KEY_IS_BASE64');
    expect(others.length).toBeGreaterThan(0);
    for (const req of others) {
      expect(req.optional).not.toBe(true);
    }
  });
});

describe('buildSetupMarkdown', () => {
  it('lists ASC_KEY_IS_BASE64 under an "(optional)" heading', () => {
    const config: Config = {
      project: { type: 'bare', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'github-actions',
      build: { production: { platform: 'ios', distribution: 'testflight' } },
    };
    const markdown = buildSetupMarkdown(deriveRequiredSecrets(config), 'github-actions');
    expect(markdown).toContain('## ASC_KEY_IS_BASE64 (optional)');
    expect(markdown).toContain('## APPLE_TEAM_ID');
    expect(markdown).not.toContain('## APPLE_TEAM_ID (optional)');
  });
});

describe('secretSetCommand', () => {
  it('uses gh for github-actions', () => {
    expect(secretSetCommand('github-actions', 'FOO')).toBe('gh secret set FOO');
  });

  it('uses glab for gitlab', () => {
    expect(secretSetCommand('gitlab', 'FOO')).toBe('glab variable set FOO');
  });
});
