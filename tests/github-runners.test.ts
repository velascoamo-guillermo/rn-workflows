import { describe, expect, test } from 'bun:test';
import yaml from 'js-yaml';
import { generateGithubActions } from '../src/generators/github-actions';
import { generateMatrixWorkflow } from '../src/generators/github-matrix';
import { isSelfHosted, renderRunsOn, runsOnFor } from '../src/generators/github-shared';
import type { Config } from '../src/config/schema';

const base: Config = {
  project: { type: 'expo', bundleId: 'com.test.app', packageName: 'com.test.app' },
  ci: 'github-actions',
  build: { production: { platform: 'all', distribution: 'store', android: { buildType: 'aab' } } },
};
const withRunners: Config = {
  ...base,
  runners: { ios: ['self-hosted', 'macos-arm'] },
  env: { SENTRY_DISABLE_AUTO_UPLOAD: 'true' },
};

type Job = { 'runs-on': unknown; env?: Record<string, string>; steps: Array<{ name?: string; uses?: string; run?: string }> };
function jobs(content: string): Record<string, Job> {
  return (yaml.load(content) as { jobs: Record<string, Job> }).jobs;
}

describe('shared helpers', () => {
  test('runsOnFor defaults and overrides', () => {
    expect(runsOnFor(base, 'ios')).toBe('macos-latest');
    expect(runsOnFor(base, 'android')).toBe('ubuntu-latest');
    expect(runsOnFor(withRunners, 'ios')).toEqual(['self-hosted', 'macos-arm']);
    expect(runsOnFor(withRunners, 'android')).toBe('ubuntu-latest');
  });
  test('isSelfHosted', () => {
    expect(isSelfHosted('macos-latest')).toBe(false);
    expect(isSelfHosted(['self-hosted', 'x'])).toBe(true);
    expect(isSelfHosted(['macos-14'])).toBe(false);
  });
  test('renderRunsOn', () => {
    expect(renderRunsOn('ubuntu-latest')).toBe('ubuntu-latest');
    expect(renderRunsOn(['self-hosted', 'macos-arm'])).toBe('[self-hosted, macos-arm]');
  });
});

describe('per-app workflow', () => {
  test('flow-sequence runs-on, android default kept', () => {
    const { content } = generateGithubActions(withRunners)[0]!;
    expect(content).toContain('runs-on: [self-hosted, macos-arm]');
    const j = jobs(content);
    expect(j['build-ios']!['runs-on']).toEqual(['self-hosted', 'macos-arm']);
    expect(j['build-android']!['runs-on']).toBe('ubuntu-latest');
  });
  test('self-hosted job skips ruby/xcode setup and runs bundle install', () => {
    const j = jobs(generateGithubActions(withRunners)[0]!.content);
    const ios = j['build-ios']!.steps;
    expect(ios.some((s) => s.uses?.startsWith('ruby/setup-ruby'))).toBe(false);
    expect(ios.some((s) => s.uses?.startsWith('maxim-lobanov/setup-xcode'))).toBe(false);
    expect(ios.some((s) => s.run === 'bundle install')).toBe(true);
    const android = j['build-android']!.steps;
    expect(android.some((s) => s.uses?.startsWith('ruby/setup-ruby'))).toBe(true);
  });
  test('ci.env only on build jobs', () => {
    const cfg: Config = { ...withRunners, checks: { test: true } };
    const j = jobs(generateGithubActions(cfg)[0]!.content);
    expect(j['build-ios']!.env).toEqual({ SENTRY_DISABLE_AUTO_UPLOAD: 'true' });
    expect(j['build-android']!.env).toEqual({ SENTRY_DISABLE_AUTO_UPLOAD: 'true' });
    expect(j['quality']!.env).toBeUndefined();
  });
  test('smart (ota) workflow: env on native + ota jobs, self-hosted steps', () => {
    const cfg: Config = {
      ...withRunners,
      build: { production: { ...base.build.production!, ota: { server: 'https://o.example.com', channel: 'production' } } },
    };
    const j = jobs(generateGithubActions(cfg)[0]!.content);
    expect(j['native-ios']!['runs-on']).toEqual(['self-hosted', 'macos-arm']);
    expect(j['native-ios']!.env).toEqual({
      SENTRY_DISABLE_AUTO_UPLOAD: 'true',
      EXPO_UPDATES_FINGERPRINT_OVERRIDE: '${{ needs.fingerprint.outputs.ios_hash }}',
    });
    expect(j['fingerprint']!.env).toBeUndefined();
    // The OTA bundle must be exported with the same env as the native build (e.g. EXPO_PUBLIC_*).
    expect(j['ota-ios']!['runs-on']).toEqual(['self-hosted', 'macos-arm']);
    expect(j['ota-ios']!.env).toEqual({ SENTRY_DISABLE_AUTO_UPLOAD: 'true' });
    expect(j['native-ios']!.steps.some((s) => s.uses?.startsWith('ruby/setup-ruby'))).toBe(false);
  });
  test('no runners/env: unchanged defaults', () => {
    const j = jobs(generateGithubActions(base)[0]!.content);
    expect(j['build-ios']!['runs-on']).toBe('macos-latest');
    expect(j['build-ios']!.env).toBeUndefined();
  });
});

describe('matrix workflow', () => {
  test('legs carry runsOn and selfHosted', () => {
    const { content } = generateMatrixWorkflow([{ dir: 'apps/a', slug: 'a', config: withRunners }]);
    const legsText = (yaml.load(content) as { jobs: { plan: { env: { RELEASE_LEGS: string } } } }).jobs.plan.env.RELEASE_LEGS;
    expect(legsText).toContain('"selfHosted":true');
    expect(legsText).toContain('"runsOn":["self-hosted","macos-arm"]');
    expect(legsText).toContain('"runsOn":"ubuntu-latest"');
    expect(legsText).toContain('"selfHosted":false');
  });
  test('release job gates ruby/xcode on selfHosted and bundle installs', () => {
    const { content } = generateMatrixWorkflow([{ dir: 'apps/a', slug: 'a', config: withRunners }]);
    expect(content).toContain('!matrix.selfHosted');
    expect(content).toContain('run: bundle install');
  });
});
