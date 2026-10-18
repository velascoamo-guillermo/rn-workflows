import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import type { BuildProfile } from '../src/config/schema.ts';
import { readExpoUpdatesConfig } from '../src/utils/expo.ts';
import { buildOtaSetupSection, checkOtaReadiness } from '../src/utils/ota-setup.ts';

const fx = (name: string): string => resolve(import.meta.dir, 'fixtures', 'expo-app-json', name);

const profile = (over: Partial<BuildProfile> = {}): BuildProfile => ({
  platform: 'all',
  distribution: 'testflight',
  ota: { server: 'https://ota.example.com', channel: 'production' },
  e2e: { maestro: { flows: '.maestro' } },
  ...over,
} as BuildProfile);

const messages = (dir: string, p: BuildProfile, level?: 'warn' | 'note'): string[] =>
  checkOtaReadiness(fx(dir), 'release', p)
    .filter((f) => !level || f.level === level)
    .map((f) => f.message);

describe('readExpoUpdatesConfig', () => {
  test('reads static config', () => {
    const c = readExpoUpdatesConfig(fx('ready'));
    expect(c).toMatchObject({
      kind: 'static',
      runtimePolicy: 'fingerprint',
      updatesUrl: 'https://ota.example.com/api/manifest',
      channel: 'production',
      hasExpoUpdates: true,
    });
  });
  test('dynamic config is flagged', () => {
    expect(readExpoUpdatesConfig(fx('dynamic')).kind).toBe('dynamic');
  });
  test('detects missing expo-updates dependency', () => {
    const c = readExpoUpdatesConfig(fx('no-dep'));
    expect(c.kind === 'static' && c.hasExpoUpdates).toBe(false);
  });
});

describe('checkOtaReadiness', () => {
  test('ready app has no warnings', () => {
    expect(messages('ready', profile(), 'warn')).toEqual([]);
  });
  test('no ota block -> nothing', () => {
    expect(messages('no-policy', profile({ ota: undefined, e2e: undefined }))).toEqual([]);
  });
  test('warns when runtimeVersion policy is not fingerprint', () => {
    expect(messages('no-policy', profile(), 'warn').join('\n')).toContain('fingerprint');
  });
  test('warns on updates.url mismatch', () => {
    expect(messages('wrong-url', profile(), 'warn').join('\n')).toContain('updates.url');
  });
  test('warns on channel header mismatch', () => {
    expect(messages('wrong-channel', profile(), 'warn').join('\n')).toContain('expo-channel-name');
  });
  test('warns when expo-updates is missing', () => {
    expect(messages('no-dep', profile(), 'warn').join('\n')).toContain('expo-updates');
  });
  test('dynamic config yields a single warning', () => {
    expect(messages('dynamic', profile(), 'warn')).toHaveLength(1);
  });
  test('notes untested OTA when no e2e', () => {
    const notes = messages('ready', profile({ e2e: undefined }), 'note').join('\n');
    expect(notes).toContain('e2e');
  });
  test('no untested note when e2e is configured', () => {
    expect(messages('ready', profile(), 'note').join('\n')).not.toContain('untested');
  });
  test('notes missing code signing', () => {
    expect(messages('ready', profile(), 'note').join('\n')).toContain('codeSigningCertificate');
  });
  test('warns on android e2e against localhost', () => {
    const p = profile({ ota: { server: 'http://localhost:3000', channel: 'production' } });
    expect(messages('ready', p, 'warn').join('\n')).toContain('localhost');
  });
  test('localhost is fine for ios-only e2e', () => {
    const p = profile({
      platform: 'ios',
      ota: { server: 'http://localhost:3000', channel: 'production' },
    });
    expect(messages('ready', p, 'warn').filter((m) => m.includes('Android'))).toEqual([]);
  });
});

describe('buildOtaSetupSection', () => {
  test('empty without ota profiles', () => {
    expect(buildOtaSetupSection([{ name: 'p', profile: profile({ ota: undefined }), findings: [] }])).toBe('');
  });
  test('includes static guidance and findings, aggregated per app', () => {
    const out = buildOtaSetupSection([
      { app: 'a', name: 'release', profile: profile(), findings: [{ level: 'warn', message: 'WARN-A' }] },
      { app: 'b', name: 'release', profile: profile(), findings: [{ level: 'note', message: 'NOTE-B' }] },
    ]);
    expect(out).toContain('## OTA updates');
    expect(out).toContain('rnw-update-id');
    expect(out).toContain('jq');
    expect(out).toContain('rnw/native/');
    expect(out).toContain('contents: write');
    expect(out).toContain('a/release');
    expect(out).toContain('WARN-A');
    expect(out).toContain('b/release');
    expect(out).toContain('NOTE-B');
  });
});
