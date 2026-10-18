import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/config/parser';
import { generateGithubActions } from '../src/generators/github-actions';
import { legConcurrencyGroup, nativeTagPrefix } from '../src/generators/github-shared';
import type { Config } from '../src/config/schema';
import { parseWorkflow } from './helpers/run-step';

const baseOtaConfig: Config = {
  project: { type: 'expo', bundleId: 'com.test.app', packageName: 'com.test.app' },
  ci: 'github-actions',
  build: {
    production: {
      platform: 'all',
      distribution: 'store',
      android: { buildType: 'aab' },
      ota: { server: 'https://ota.myapp.com', channel: 'production' },
    },
  },
};

const iosOnlyConfig: Config = {
  ...baseOtaConfig,
  build: {
    production: { platform: 'ios', distribution: 'testflight', ota: { server: 'http://localhost:3000', channel: 'production' } },
  },
};

const content = generateGithubActions(baseOtaConfig)[0]!.content;
const wf = parseWorkflow(content);

describe('shared OTA naming helpers', () => {
  test('nativeTagPrefix', () => {
    expect(nativeTagPrefix({ profile: 'production', platform: 'ios' })).toBe('rnw/native/production/ios');
    expect(nativeTagPrefix({ appSlug: 'pawlog', profile: 'production', platform: 'android' })).toBe(
      'rnw/native/pawlog/production/android',
    );
  });
  test('legConcurrencyGroup', () => {
    expect(legConcurrencyGroup({ profile: 'production', platform: 'ios' })).toBe('rnw-production-ios');
    expect(legConcurrencyGroup({ appSlug: 'pawlog', profile: 'staging', platform: 'android' })).toBe(
      'rnw-pawlog-staging-android',
    );
  });
});

describe('smart (OTA) workflow shape', () => {
  test('workflow token is read-only by default', () => {
    expect(wf.permissions).toEqual({ contents: 'read' });
  });

  test('legacy jobs are gone: no ota-update, no save-fingerprint, no cache marker', () => {
    expect(Object.keys(wf.jobs)).not.toContain('ota-update');
    expect(Object.keys(wf.jobs)).not.toContain('save-fingerprint');
    expect(content).not.toContain('.rn-fingerprint');
    expect(content).not.toContain('actions/cache');
    expect(content).not.toContain('@expo/fingerprint');
  });

  test('fingerprint job exposes per-platform hash + native_exists outputs', () => {
    expect(wf.jobs.fingerprint!.outputs).toEqual({
      ios_hash: '${{ steps.fp-ios.outputs.hash }}',
      ios_native_exists: '${{ steps.native-ios.outputs.exists }}',
      android_hash: '${{ steps.fp-android.outputs.hash }}',
      android_native_exists: '${{ steps.native-android.outputs.exists }}',
    });
  });

  test('fingerprint steps use expo-updates runtimeversion:resolve and the tag prefix', () => {
    for (const p of ['ios', 'android'] as const) {
      const fp = wf.jobs.fingerprint!.steps.find((s) => s.id === `fp-${p}`)!;
      expect(fp.run).toContain('runtimeversion:resolve --platform "$RNW_PLATFORM"');
      expect(fp.env).toEqual({ RNW_PLATFORM: p });
      const lookup = wf.jobs.fingerprint!.steps.find((s) => s.id === `native-${p}`)!;
      expect(lookup.run).toContain('git ls-remote --exit-code --tags origin');
      expect(lookup.env).toEqual({ RNW_TAG_PREFIX: `rnw/native/production/${p}`, RNW_HASH: `\${{ steps.fp-${p}.outputs.hash }}` });
    }
  });

  test('ota-<p> jobs: gated on native_exists, one concurrency group per leg, never cancelled', () => {
    for (const p of ['ios', 'android'] as const) {
      const job = wf.jobs[`ota-${p}`]!;
      expect(job.needs).toBe('fingerprint');
      expect(job.if).toBe(`needs.fingerprint.outputs.${p}_native_exists == 'true'`);
      expect(job.concurrency).toEqual({ group: `rnw-production-${p}`, 'cancel-in-progress': false });
      expect(job.permissions).toBeUndefined();
    }
  });

  test('exports per platform, never --platform all', () => {
    expect(content).not.toContain('--platform all');
    for (const p of ['ios', 'android'] as const) {
      const exp = wf.jobs[`ota-${p}`]!.steps.find((s) => s.id === 'export')!;
      expect(exp.run).toContain('expo export --platform "$RNW_PLATFORM"');
      expect(exp.env).toEqual({ RNW_PLATFORM: p });
    }
  });

  test('upload step: per-platform runtimeVersion + channel via env, secret via env', () => {
    for (const p of ['ios', 'android'] as const) {
      const up = wf.jobs[`ota-${p}`]!.steps.find((s) => s.id === 'upload')!;
      expect(up.env).toEqual({
        RNW_OTA_SERVER: 'https://ota.myapp.com',
        RNW_CHANNEL: 'production',
        RNW_HASH: `\${{ needs.fingerprint.outputs.${p}_hash }}`,
        RNW_COMMIT_MESSAGE: '${{ github.event.head_commit.message }}',
        OTA_UPLOAD_KEY: '${{ secrets.OTA_UPLOAD_KEY }}',
      });
      expect(up.run).toContain('--fail-with-body');
    }
  });

  test('update-id step exposes update_id', () => {
    const step = wf.jobs['ota-ios']!.steps.find((s) => s.id === 'update-id')!;
    expect(step.run).toContain('update_id=');
  });

  test('no `${{` inside any run:', () => {
    for (const [id, job] of Object.entries(wf.jobs)) {
      for (const step of job.steps) {
        if (step.run) expect({ id, run: step.run }).toEqual({ id, run: expect.not.stringContaining('${{') });
      }
    }
  });

  test('no `${{` inside any run: for every ota-* fixture × monorepo/bun variants', () => {
    const dir = join(import.meta.dir, 'fixtures');
    const names = readdirSync(dir).filter((f) => f.startsWith('ota-') && f.endsWith('.yml'));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const cfg = loadConfig(join(dir, name));
      for (const opts of [{}, { appDir: 'apps/x', appSlug: 'x', packageManager: 'bun' as const }]) {
        for (const file of generateGithubActions(cfg, opts)) {
          for (const job of Object.values(parseWorkflow(file.content).jobs)) {
            for (const step of job.steps) {
              if (step.run) expect({ name, run: step.run }).toEqual({ name, run: expect.not.stringContaining('${{') });
            }
          }
        }
      }
    }
  });

  test('native-<p> jobs share the leg concurrency group with ota-<p>, never cancelled', () => {
    for (const p of ['ios', 'android'] as const) {
      expect(wf.jobs[`native-${p}`]!.concurrency).toEqual({ group: `rnw-production-${p}`, 'cancel-in-progress': false });
    }
  });

  test('native-<p> re-checks the tag right before fastlane and gates lane + tag on it', () => {
    for (const p of ['ios', 'android'] as const) {
      const steps = wf.jobs[`native-${p}`]!.steps;
      const recheck = steps.findIndex((s) => s.id === 'recheck');
      const fastlane = steps.findIndex((s) => s.run?.startsWith('bundle exec fastlane'));
      expect(recheck).toBe(fastlane - 1);
      expect(steps[recheck]!.env).toEqual({
        RNW_TAG_PREFIX: `rnw/native/production/${p}`,
        RNW_HASH: `\${{ needs.fingerprint.outputs.${p}_hash }}`,
      });
      const gate = "steps.recheck.outputs.exists != 'true'";
      expect(steps[fastlane]!.if).toBe(gate);
      expect(steps.find((s) => s.id === 'tag')!.if).toBe(gate);
    }
  });

  test('fingerprint job fails on identical ios/android runtimeVersion only when both platforms are built', () => {
    const step = wf.jobs.fingerprint!.steps.find((s) => s.id === 'fp-distinct')!;
    expect(step.env).toEqual({
      RNW_IOS_HASH: '${{ steps.fp-ios.outputs.hash }}',
      RNW_ANDROID_HASH: '${{ steps.fp-android.outputs.hash }}',
    });
    const ios = parseWorkflow(generateGithubActions(iosOnlyConfig)[0]!.content);
    expect(ios.jobs.fingerprint!.steps.find((s) => s.id === 'fp-distinct')).toBeUndefined();
  });

  test('upload has connect + total timeouts', () => {
    const up = wf.jobs['ota-ios']!.steps.find((s) => s.id === 'upload')!;
    expect(up.run).toContain('--connect-timeout 30');
    expect(up.run).toContain('--max-time 600');
  });

  test('native-<p> jobs: gated, fingerprint override, contents: write, tag pushed after fastlane', () => {
    for (const p of ['ios', 'android'] as const) {
      const job = wf.jobs[`native-${p}`]!;
      expect(job.needs).toBe('fingerprint');
      expect(job.if).toBe(`needs.fingerprint.outputs.${p}_native_exists != 'true'`);
      expect(job.permissions).toEqual({ contents: 'write' });
      expect(job.env?.EXPO_UPDATES_FINGERPRINT_OVERRIDE).toBe(`\${{ needs.fingerprint.outputs.${p}_hash }}`);
      const fastlane = job.steps.findIndex((s) => s.run?.startsWith('bundle exec fastlane'));
      const tag = job.steps.findIndex((s) => s.id === 'tag');
      expect(fastlane).toBeGreaterThan(-1);
      expect(tag).toBeGreaterThan(fastlane);
      expect(job.steps[tag]!.env).toEqual({
        RNW_TAG_PREFIX: `rnw/native/production/${p}`,
        RNW_HASH: `\${{ needs.fingerprint.outputs.${p}_hash }}`,
      });
    }
  });

  test('contents: write appears only on native jobs', () => {
    for (const [id, job] of Object.entries(wf.jobs)) {
      if (!id.startsWith('native-')) expect(job.permissions?.contents).not.toBe('write');
    }
  });

  test('ios-only profile has no android jobs, steps or outputs', () => {
    const c = generateGithubActions(iosOnlyConfig)[0]!.content;
    expect(c).not.toContain('android');
    const jobs = Object.keys(parseWorkflow(c).jobs);
    expect(jobs).toEqual(['fingerprint', 'ota-ios', 'native-ios']);
  });

  test('appSlug flows into tag prefix and concurrency group', () => {
    const c = parseWorkflow(generateGithubActions(iosOnlyConfig, { appSlug: 'pawlog' })[0]!.content);
    expect(c.jobs['ota-ios']!.concurrency?.group).toBe('rnw-pawlog-production-ios');
    expect(c.jobs['native-ios']!.steps.find((s) => s.id === 'tag')!.env?.RNW_TAG_PREFIX).toBe(
      'rnw/native/pawlog/production/ios',
    );
  });

  test('bun projects use bunx expo for config + export', () => {
    const c = parseWorkflow(generateGithubActions(baseOtaConfig, { packageManager: 'bun' })[0]!.content);
    const steps = c.jobs['ota-ios']!.steps;
    expect(steps.find((s) => s.id === 'export')!.run).toContain('bunx expo export');
    expect(steps.find((s) => s.id === 'package')!.run).toContain('bunx expo config --type public --json');
  });

  test('profile without ota uses original workflow template', () => {
    const noOtaConfig: Config = {
      project: { type: 'expo', bundleId: 'com.test.app', packageName: 'com.test.app' },
      ci: 'github-actions',
      build: { production: { platform: 'android', distribution: 'firebase' } },
    };
    const { content: c } = generateGithubActions(noOtaConfig)[0]!;
    expect(c).not.toContain('fingerprint');
    expect(c).not.toContain('permissions:');
  });

  test('ios/android jobs do not duplicate expo prebuild / pod install — fastlane prebuild lane owns it', () => {
    expect(content).not.toContain('expo prebuild');
    expect(content).not.toContain('pod install');
  });

  test('output matches snapshot', () => {
    expect(content).toMatchSnapshot();
  });
});
