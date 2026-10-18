import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig } from '../src/config/parser.ts';
import {
  e2ePlatforms,
  resolveAndroidTrack,
  resolveStagingChannel,
  type BuildProfile,
} from '../src/config/schema.ts';
import { ALL_SECRET_NAMES } from '../src/secrets.ts';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8');

interface Opts {
  channel?: string;
  stagingChannel?: string | null;
  platform?: string;
  ota?: boolean;
  e2e?: string;
  ci?: string;
}

function cfg(o: Opts = {}): string {
  const ota =
    o.ota === false
      ? ''
      : `    ota:
      server: https://ota.example.com
      channel: ${o.channel ?? 'production'}
${o.stagingChannel === null || o.stagingChannel === undefined ? '' : `      stagingChannel: ${o.stagingChannel}\n`}`;
  return `project:
  type: expo
  bundleId: com.example.app
  packageName: com.example.app
${o.ci ?? 'ci: github-actions'}
build:
  production:
    platform: ${o.platform ?? 'all'}
    distribution: store
${ota}${o.e2e ?? ''}`;
}

const e2e = (body: string): string => `    e2e:
      maestro:
${body}`;

describe('ota/e2e fixtures', () => {
  it('parses ota-e2e-all', () => {
    const c = parseConfig(fixture('ota-e2e-all.yml'));
    const p = c.build.production!;
    expect(p.ota?.stagingChannel).toBe('staging');
    expect(p.e2e?.maestro.flows).toBe('.maestro');
    expect(p.e2e?.maestro.platforms).toEqual(['ios', 'android']);
  });
  it('parses ota-e2e-ios-selfhosted', () => {
    const c = parseConfig(fixture('ota-e2e-ios-selfhosted.yml'));
    expect(c.runners).toEqual({ ios: ['self-hosted', 'macos-arm'] });
    expect(c.env).toEqual({ SENTRY_DISABLE_AUTO_UPLOAD: 'true' });
    expect(c.build.production?.e2e?.maestro.iosDevice).toBe('iPhone 16 Pro Max');
  });
  it('parses ota-no-e2e-android', () => {
    const c = parseConfig(fixture('ota-no-e2e-android.yml'));
    expect(c.build.production?.android?.track).toBe('internal');
    expect(c.build.production?.e2e).toBeUndefined();
  });
  it('leaves existing configs without new keys', () => {
    const c = parseConfig(fixture('production-with-ota.yml'));
    expect('runners' in c).toBe(false);
    expect('env' in c).toBe(false);
  });
});

describe('stagingChannel / e2e rules', () => {
  const flows = e2e('        flows: .maestro\n');
  it('rejects stagingChannel equal to channel', () => {
    expect(() => parseConfig(cfg({ stagingChannel: 'production' }))).toThrow(/stagingChannel/);
  });
  it('rejects unsafe stagingChannel', () => {
    expect(() => parseConfig(cfg({ stagingChannel: "'a b'" }))).toThrow();
  });
  it('rejects e2e when channel is staging and stagingChannel unset', () => {
    expect(() => parseConfig(cfg({ channel: 'staging', e2e: flows }))).toThrow(/stagingChannel/);
  });
  it('accepts e2e with channel staging when stagingChannel differs', () => {
    expect(() =>
      parseConfig(cfg({ channel: 'staging', stagingChannel: 'qa', e2e: flows })),
    ).not.toThrow();
  });
  it('rejects e2e without ota', () => {
    expect(() => parseConfig(cfg({ ota: false, e2e: flows }))).toThrow(/ota/);
  });
  it('rejects e2e platforms outside the profile', () => {
    const body = e2e('        flows: .maestro\n        platforms: [android]\n');
    expect(() => parseConfig(cfg({ platform: 'ios', e2e: body }))).toThrow(/platform/);
  });
  it('rejects empty e2e platforms', () => {
    const body = e2e('        flows: .maestro\n        platforms: []\n');
    expect(() => parseConfig(cfg({ e2e: body }))).toThrow();
  });
  for (const bad of ['../x', 'a/../b', '/abs', 'a;b', '$(x)', 'a b', '']) {
    it(`rejects flows ${JSON.stringify(bad)}`, () => {
      const body = e2e(`        flows: ${JSON.stringify(bad)}\n`);
      expect(() => parseConfig(cfg({ e2e: body }))).toThrow();
    });
  }
  it('accepts nested flows path', () => {
    expect(() =>
      parseConfig(cfg({ e2e: e2e('        flows: e2e/.maestro_flows-1\n') })),
    ).not.toThrow();
  });
  it('rejects iosDevice with metacharacters', () => {
    const body = e2e('        flows: .maestro\n        iosDevice: "iPhone; rm"\n');
    expect(() => parseConfig(cfg({ e2e: body }))).toThrow();
  });
});

describe('ci.runners / ci.env', () => {
  const ci = (body: string): string => `ci:\n  provider: github-actions\n${body}`;
  it('accepts valid runners and env', () => {
    const c = parseConfig(
      cfg({ ota: false, ci: ci('  runners:\n    android: [ubuntu-latest]\n  env:\n    FOO_BAR: a/b:c@d+e,f=g-h\n') }),
    );
    expect(c.runners).toEqual({ android: ['ubuntu-latest'] });
    expect(c.env).toEqual({ FOO_BAR: 'a/b:c@d+e,f=g-h' });
  });
  it('rejects bad runner labels', () => {
    expect(() =>
      parseConfig(cfg({ ota: false, ci: ci('  runners:\n    ios: ["a b"]\n') })),
    ).toThrow();
  });
  it('rejects empty runner list', () => {
    expect(() => parseConfig(cfg({ ota: false, ci: ci('  runners:\n    ios: []\n') }))).toThrow();
  });
  it('rejects env key that is a secret name', () => {
    const name = ALL_SECRET_NAMES[0]!;
    expect(() =>
      parseConfig(cfg({ ota: false, ci: ci(`  env:\n    ${name}: x\n`) })),
    ).toThrow(/secret/);
  });
  for (const key of ['RNW_FOO', 'GITHUB_FOO', 'RUNNER_FOO', 'ACTIONS_FOO', 'lower', '1A']) {
    it(`rejects env key ${key}`, () => {
      expect(() =>
        parseConfig(cfg({ ota: false, ci: ci(`  env:\n    ${key}: x\n`) })),
      ).toThrow();
    });
  }
  for (const val of ['"a\\nb"', '"a\'b"', '"a\\"b"', '"$X"', '"a b"']) {
    it(`rejects env value ${val}`, () => {
      expect(() =>
        parseConfig(cfg({ ota: false, ci: ci(`  env:\n    FOO: ${val}\n`) })),
      ).toThrow();
    });
  }
  it('ALL_SECRET_NAMES contains known secrets', () => {
    expect(ALL_SECRET_NAMES).toContain('MATCH_PASSWORD');
    expect(ALL_SECRET_NAMES).toContain('PLAY_STORE_JSON_KEY');
  });
});

describe('resolvers', () => {
  const base = { platform: 'all', distribution: 'store' } as const;
  const ota = { server: 'https://o.example.com', channel: 'production' };
  it('resolveAndroidTrack: explicit wins', () => {
    const p: BuildProfile = { ...base, android: { track: 'beta' }, ota };
    expect(resolveAndroidTrack(p)).toBe('beta');
  });
  it('resolveAndroidTrack: internal when ota', () => {
    expect(resolveAndroidTrack({ ...base, ota })).toBe('internal');
  });
  it('resolveAndroidTrack: production otherwise', () => {
    expect(resolveAndroidTrack({ ...base })).toBe('production');
  });
  it('resolveStagingChannel defaults to staging', () => {
    expect(resolveStagingChannel(ota)).toBe('staging');
    expect(resolveStagingChannel({ ...ota, stagingChannel: 'qa' })).toBe('qa');
  });
  it('e2ePlatforms defaults to profile platforms', () => {
    const m = { flows: '.maestro' };
    expect(e2ePlatforms({ ...base, e2e: { maestro: m } })).toEqual(['ios', 'android']);
    expect(e2ePlatforms({ ...base, platform: 'ios', e2e: { maestro: m } })).toEqual(['ios']);
    expect(
      e2ePlatforms({ ...base, e2e: { maestro: { ...m, platforms: ['android'] } } }),
    ).toEqual(['android']);
  });
});
