/**
 * Shape acceptance for the smart (OTA) workflow with `e2e.maestro`:
 * staging upload → cached staging-patched test binary → Maestro (update-id
 * guard first) → promote, all inside `ota-<p>`; native path runs e2e before
 * the store lane.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { loadConfig } from '../src/config/parser';
import { generateGithubActions } from '../src/generators/github-actions';
import { e2eCacheKey } from '../src/generators/github-shared';
import type { Config } from '../src/config/schema';
import { parseWorkflow, stepRuns, type WorkflowJob, type WorkflowStep } from './helpers/run-step';

const fixture = (name: string): Config => loadConfig(join(import.meta.dir, 'fixtures', name));

const allCfg = fixture('ota-e2e-all.yml');
const all = parseWorkflow(generateGithubActions(allCfg, { scheme: 'OtaAll' })[0]!.content);
const selfHostedContent = generateGithubActions(fixture('ota-e2e-ios-selfhosted.yml'), { scheme: 'SelfHosted' })[0]!.content;
const selfHosted = parseWorkflow(selfHostedContent);

const iosOnlyE2eCfg: Config = {
  ...allCfg,
  build: {
    production: {
      ...allCfg.build.production!,
      e2e: { maestro: { flows: '.maestro', platforms: ['ios'] } },
    },
  },
};
const iosOnlyE2e = parseWorkflow(generateGithubActions(iosOnlyE2eCfg, { scheme: 'OtaAll' })[0]!.content);

const noE2eCfg: Config = {
  ...allCfg,
  build: { production: { ...allCfg.build.production!, e2e: undefined } },
};
const noE2eContent = generateGithubActions(noE2eCfg, { scheme: 'OtaAll' })[0]!.content;

const idx = (job: WorkflowJob, pred: (s: WorkflowStep) => boolean): number => job.steps.findIndex(pred);
const byId = (id: string) => (s: WorkflowStep): boolean => s.id === id;
const isFastlane = (s: WorkflowStep): boolean => s.run?.startsWith('bundle exec fastlane') ?? false;
/** Native-release path of a native-<p> job: everything up to the tag re-check (excludes the recheck-hit OTA branch). */
const nativePath = (job: WorkflowJob): WorkflowJob => ({ ...job, steps: job.steps.slice(0, idx(job, byId('recheck'))) });

describe('e2eCacheKey', () => {
  test('rnw-e2e-[<slug>-]<profile>-<platform>-<stagingChannel>-<hash>', () => {
    expect(e2eCacheKey({ profile: 'production', platform: 'ios' }, 'staging', 'abc')).toBe('rnw-e2e-production-ios-staging-abc');
    expect(e2eCacheKey({ appSlug: 'pawlog', profile: 'production', platform: 'android' }, 'qa', 'abc')).toBe(
      'rnw-e2e-pawlog-production-android-qa-abc',
    );
  });
});

describe('ota-<p> with e2e: package → upload(staging) → binary → guard → flows → promote', () => {
  for (const p of ['ios', 'android'] as const) {
    test(`${p}: step order and channels`, () => {
      const job = all.jobs[`ota-${p}`]!;
      const updateId = idx(job, byId('update-id'));
      const staging = idx(job, byId('upload-staging'));
      const build = idx(job, byId('e2e-build'));
      const guard = idx(job, byId('guard-flow'));
      const maestro = idx(job, byId('maestro'));
      const promote = idx(job, byId('promote'));
      expect(updateId).toBeGreaterThan(-1);
      expect(staging).toBeGreaterThan(updateId);
      expect(build).toBeGreaterThan(staging);
      expect(guard).toBeGreaterThan(build);
      expect(maestro).toBeGreaterThan(guard);
      expect(promote).toBeGreaterThan(maestro);
      expect(promote).toBe(job.steps.length - 1);
      expect(job.steps[staging]!.env?.RNW_CHANNEL).toBe('staging');
      expect(job.steps[promote]!.env?.RNW_CHANNEL).toBe('production');
      for (const i of [staging, promote]) {
        expect(job.steps[i]!.env?.RNW_HASH).toBe(`\${{ needs.fingerprint.outputs.${p}_hash }}`);
        expect(job.steps[i]!.run).toContain('file=@bundle.zip');
      }
      expect(job.steps.some(byId('upload'))).toBe(false);
    });

    test(`${p}: promote can't run after a failure (no always()/continue-on-error)`, () => {
      const job = all.jobs[`ota-${p}`]!;
      expect(job.if ?? '').not.toContain('always()');
      for (const s of job.steps) {
        expect(s.if ?? '').not.toMatch(/always\(\)|failure\(\)|cancelled\(\)/);
        expect((s as Record<string, unknown>)['continue-on-error']).toBeUndefined();
      }
      expect((job as unknown as Record<string, unknown>)['continue-on-error']).toBeUndefined();
    });

    test(`${p}: guard flow gets the update id; flows get it too`, () => {
      const job = all.jobs[`ota-${p}`]!;
      const guard = job.steps.find(byId('guard-flow'))!;
      expect(guard.run).toContain('$RUNNER_TEMP/rnw-assert-update.yaml');
      expect(guard.run).toContain('id: rnw-update-id');
      expect(guard.run).toContain('text: ${RNW_EXPECTED_UPDATE_ID}');
      const runner = job.steps.find(byId('maestro'))!;
      expect(runner.env?.RNW_EXPECTED_UPDATE_ID).toBe('${{ steps.update-id.outputs.update_id }}');
    });

    test(`${p}: test binary is built with the fingerprint override and cached by hash`, () => {
      const job = all.jobs[`ota-${p}`]!;
      const build = job.steps.find(byId('e2e-build'))!;
      expect(build.env?.EXPO_UPDATES_FINGERPRINT_OVERRIDE).toBe(`\${{ needs.fingerprint.outputs.${p}_hash }}`);
      const restore = job.steps.find(byId('e2e-cache'))!;
      expect(restore.uses).toBe('actions/cache/restore@v4');
      expect(restore.with).toEqual({
        path: `\${{ runner.temp }}/rnw-e2e/${p}`,
        key: `rnw-e2e-production-${p}-staging-\${{ needs.fingerprint.outputs.${p}_hash }}`,
      });
      for (const id of ['e2e-prebuild', 'e2e-patch', 'e2e-build', 'e2e-save']) {
        expect({ id, if: job.steps.find(byId(id))!.if }).toEqual({ id, if: "steps.e2e-cache.outputs.cache-hit != 'true'" });
      }
    });
  }

  test('ios: plist path, staging channel and device come through env', () => {
    const job = all.jobs['ota-ios']!;
    const patch = job.steps.find(byId('e2e-patch'))!;
    expect(patch.run).toContain('ios/$RNW_SCHEME/Supporting/Expo.plist');
    expect(patch.env).toEqual({ RNW_SCHEME: 'OtaAll', RNW_STAGING_CHANNEL: 'staging' });
    const build = job.steps.find(byId('e2e-build'))!;
    expect(build.run).toContain('-sdk iphonesimulator');
    expect(build.run).toContain('CODE_SIGNING_ALLOWED=NO');
    const sim = job.steps.find(byId('simulator'))!;
    expect(sim.env?.RNW_IOS_DEVICE).toBeUndefined();
    const sh = selfHosted.jobs['ota-ios']!.steps.find(byId('simulator'))!;
    expect(sh.env?.RNW_IOS_DEVICE).toBe('iPhone 16 Pro Max');
  });

  test('android: assembleRelease, pinned emulator runner, API 34 x86_64, KVM', () => {
    const job = all.jobs['ota-android']!;
    expect(job.steps.find(byId('e2e-build'))!.run).toContain('assembleRelease');
    const emu = job.steps.find((s) => s.uses?.startsWith('reactivecircus/android-emulator-runner@'))!;
    expect(emu.uses).toMatch(/@v\d+\.\d+\.\d+$/);
    expect(emu.with?.['api-level']).toBe(34);
    expect(emu.with?.arch).toBe('x86_64');
    expect(String(emu.with?.script)).not.toContain('${{');
    expect(job.steps.some((s) => s.run?.includes('kvm'))).toBe(true);
    expect(idx(job, (s) => s === emu)).toBeLessThan(idx(job, byId('promote')));
    expect(idx(job, (s) => s === emu)).toBeGreaterThan(idx(job, byId('maestro-script')));
  });

  test('flows path is passed quoted and ./-prefixed', () => {
    expect(all.jobs['ota-ios']!.steps.find(byId('maestro'))!.run).toContain('"./$RNW_FLOWS"');
    expect(all.jobs['ota-android']!.steps.find(byId('maestro-script'))!.run).toContain('"./$RNW_FLOWS"');
  });
});

describe('native-<p> with e2e: binary → flows (no guard) → fastlane → tag', () => {
  for (const p of ['ios', 'android'] as const) {
    test(`${p}: fresh build → flows → cache save → fastlane, no guard`, () => {
      const job = all.jobs[`native-${p}`]!;
      const build = idx(job, byId('e2e-build'));
      const save = idx(job, byId('e2e-save'));
      const flows = idx(job, byId('maestro'));
      const fastlane = idx(job, isFastlane);
      expect(build).toBeGreaterThan(-1);
      expect(flows).toBeGreaterThan(build);
      expect(save).toBeGreaterThan(flows);
      expect(fastlane).toBeGreaterThan(save);
      expect(idx(job, byId('recheck'))).toBe(fastlane - 1);
      expect(idx(job, byId('tag'))).toBeGreaterThan(fastlane);
      expect(job.steps.some(byId('guard-flow'))).toBe(false);
      expect(JSON.stringify(nativePath(job).steps)).not.toContain('rnw-assert-update');
      expect(JSON.stringify(nativePath(job).steps)).not.toContain('RNW_EXPECTED_UPDATE_ID');
      expect(job.steps.find(byId('e2e-save'))!.with?.key).toBe(
        `rnw-e2e-production-${p}-staging-\${{ needs.fingerprint.outputs.${p}_hash }}`,
      );
    });

    test(`${p}: never restores the test-binary cache; builds unconditionally`, () => {
      const job = nativePath(all.jobs[`native-${p}`]!);
      expect(job.steps.some(byId('e2e-cache'))).toBe(false);
      expect(job.steps.some((s) => s.uses?.startsWith('actions/cache/restore'))).toBe(false);
      expect(JSON.stringify(job.steps)).not.toContain('cache-hit');
      for (const id of ['e2e-prebuild', 'e2e-patch', 'e2e-build', 'e2e-save', 'e2e-unpatch']) {
        expect({ id, if: job.steps.find(byId(id))!.if }).toEqual({ id, if: undefined });
      }
      expect(all.jobs[`ota-${p}`]!.steps.find(byId('e2e-cache'))!.uses).toBe('actions/cache/restore@v4');
    });
  }

  test('expo project: store binary is never patched (native dir restored after the test build)', () => {
    for (const p of ['ios', 'android'] as const) {
      const job = all.jobs[`native-${p}`]!;
      const restore = idx(job, byId('e2e-unpatch'));
      expect(restore).toBeGreaterThan(idx(job, byId('e2e-build')));
      expect(restore).toBeLessThan(idx(job, isFastlane));
    }
  });

  test('bare project: git checkout of the native dir', () => {
    const bare: Config = { ...allCfg, project: { ...allCfg.project, type: 'bare' } };
    const wf = parseWorkflow(generateGithubActions(bare, { scheme: 'OtaAll' })[0]!.content);
    const job = wf.jobs['native-ios']!;
    expect(job.steps.some(byId('e2e-prebuild'))).toBe(false);
    expect(job.steps.find(byId('e2e-unpatch'))!.run).toContain('git checkout -- ');
  });
});

describe('platform coverage', () => {
  test('e2e ios-only on platform all → android uploads straight to the channel', () => {
    const ota = iosOnlyE2e.jobs['ota-android']!;
    expect(ota.steps.find(byId('upload'))!.env?.RNW_CHANNEL).toBe('production');
    expect(ota.steps.some(byId('upload-staging'))).toBe(false);
    expect(ota.steps.some(byId('promote'))).toBe(false);
    expect(JSON.stringify(ota.steps)).not.toContain('maestro');
    expect(JSON.stringify(iosOnlyE2e.jobs['native-android']!.steps)).not.toContain('maestro');
    expect(iosOnlyE2e.jobs['ota-ios']!.steps.some(byId('promote'))).toBe(true);
  });

  test('no e2e → no staging upload, no maestro, no cache', () => {
    expect(noE2eContent).not.toContain('upload-staging');
    expect(noE2eContent).not.toContain('maestro');
    expect(noE2eContent).not.toContain('actions/cache');
    expect(noE2eContent).not.toContain('promote');
  });

  test('ios-only e2e profile has no android e2e', () => {
    expect(selfHostedContent).not.toContain('android');
    expect(Object.keys(selfHosted.jobs)).toEqual(['fingerprint', 'ota-ios', 'native-ios']);
  });

  test('self-hosted runner: Maestro install is conditional and pinned', () => {
    const install = selfHosted.jobs['ota-ios']!.steps.find(byId('maestro-install'))!;
    expect(install.run).toContain('command -v maestro');
    expect(install.env?.MAESTRO_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(selfHosted.jobs['ota-ios']!.steps.some((s) => s.uses?.startsWith('maxim-lobanov/setup-xcode'))).toBe(false);
  });

  test('hosted ota-ios with e2e selects Xcode; hosted ota-android sets up the JDK', () => {
    expect(all.jobs['ota-ios']!.steps.some((s) => s.uses?.startsWith('maxim-lobanov/setup-xcode'))).toBe(true);
    expect(all.jobs['ota-android']!.steps.some((s) => s.uses?.startsWith('actions/setup-java'))).toBe(true);
  });

  test('no `${{` inside any run:', () => {
    for (const wf of [all, selfHosted, iosOnlyE2e]) {
      for (const [id, job] of Object.entries(wf.jobs)) {
        for (const step of job.steps) {
          if (step.run) expect({ id, run: step.run }).toEqual({ id, run: expect.not.stringContaining('${{') });
        }
      }
    }
  });

  test('monorepo: emulator runner gets the app working-directory', () => {
    const wf = parseWorkflow(generateGithubActions(allCfg, { appDir: 'apps/x', appSlug: 'x', scheme: 'OtaAll' })[0]!.content);
    const emu = wf.jobs['ota-android']!.steps.find((s) => s.uses?.startsWith('reactivecircus/android-emulator-runner@'))!;
    expect(emu.with?.['working-directory']).toBe('apps/x');
    expect(wf.jobs['ota-ios']!.steps.find(byId('e2e-cache'))!.with?.key).toBe(
      'rnw-e2e-x-production-ios-staging-${{ needs.fingerprint.outputs.ios_hash }}',
    );
  });
});

describe('native-<p>: recheck hit ships this commit as an OTA instead of skipping (#54 M-1)', () => {
  const running = (job: WorkflowJob, exists: string): string[] =>
    job.steps.filter((s) => stepRuns(s, { steps: { recheck: { exists } } })).map((s) => s.id ?? s.name ?? '');
  const ordered = (ran: string[], ids: string[]): void => {
    const at = ids.map((id) => ran.indexOf(id));
    expect({ ids, at: at.every((i) => i >= 0) }).toEqual({ ids, at: true });
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  };
  const noE2e = parseWorkflow(noE2eContent);
  const step = (job: WorkflowJob, id: string): WorkflowStep => job.steps.find(byId(id))!;

  for (const p of ['ios', 'android'] as const) {
    test(`${p} e2e: hit → package → staging → binary (restore, else build) → guard → flows → promote; no fastlane/tag`, () => {
      const job = all.jobs[`native-${p}`]!;
      const ran = running(job, 'true');
      expect(ran.some((id) => job.steps.find((s) => (s.id ?? s.name) === id && isFastlane(s)))).toBe(false);
      expect(ran).not.toContain('tag');
      ordered(ran, ['recheck', 'ota-update-id', 'ota-upload-staging', 'ota-e2e-cache', 'ota-e2e-build', 'ota-guard-flow', 'ota-maestro', 'ota-promote']);
      expect(ran.at(-1)).toBe('ota-promote');
      expect(step(job, 'ota-upload-staging').env?.RNW_CHANNEL).toBe('staging');
      expect(step(job, 'ota-promote').env?.RNW_CHANNEL).toBe('production');
      expect(step(job, 'ota-maestro').env?.RNW_EXPECTED_UPDATE_ID).toBe('${{ steps.ota-update-id.outputs.update_id }}');
      expect(step(job, 'ota-e2e-cache').with?.key).toBe(`rnw-e2e-production-${p}-staging-\${{ needs.fingerprint.outputs.${p}_hash }}`);
      const cached = job.steps
        .filter((s) => stepRuns(s, { steps: { recheck: { exists: 'true' }, 'ota-e2e-cache': { 'cache-hit': 'true' } } }))
        .map((s) => s.id);
      expect(cached).toContain('ota-maestro');
      expect(cached).not.toContain('ota-e2e-build');
    });

    test(`${p} e2e: miss path unchanged (fastlane + tag, no OTA steps)`, () => {
      const job = all.jobs[`native-${p}`]!;
      const ran = running(job, 'false');
      expect(ran).toContain('tag');
      expect(job.steps.filter((s) => stepRuns(s, { steps: { recheck: { exists: 'false' } } })).some(isFastlane)).toBe(true);
      expect(ran.some((id) => id.startsWith('ota-'))).toBe(false);
      ordered(ran, ['e2e-build', 'maestro', 'e2e-save', 'recheck', 'tag']);
    });

    test(`${p} e2e: OTA branch scripts byte-identical to ota-${p}`, () => {
      const job = all.jobs[`native-${p}`]!;
      const ota = all.jobs[`ota-${p}`]!;
      for (const id of ['export', 'package', 'update-id', 'upload-staging', 'guard-flow', 'promote', 'e2e-build', 'e2e-patch']) {
        expect({ id, run: step(job, `ota-${id}`).run }).toEqual({ id, run: step(ota, id).run });
      }
    });

    test(`${p} no e2e: hit → package → upload to the channel; no fastlane/tag`, () => {
      const job = noE2e.jobs[`native-${p}`]!;
      const ran = running(job, 'true');
      ordered(ran, ['recheck', 'ota-update-id', 'ota-upload']);
      expect(ran).not.toContain('tag');
      expect(job.steps.filter((s) => stepRuns(s, { steps: { recheck: { exists: 'true' } } })).some(isFastlane)).toBe(false);
      expect(step(job, 'ota-upload').env?.RNW_CHANNEL).toBe('production');
      expect(step(job, 'ota-upload').run).toBe(step(noE2e.jobs[`ota-${p}`]!, 'upload').run);
      expect(running(job, 'false').some((id) => id.startsWith('ota-'))).toBe(false);
    });
  }

  test('no always()/failure()/cancelled()/continue-on-error on the native jobs; step ids unique', () => {
    for (const wf of [all, noE2e, selfHosted]) {
      for (const [id, job] of Object.entries(wf.jobs)) {
        if (!id.startsWith('native-')) continue;
        for (const s of job.steps) {
          expect(String(s.if ?? '')).not.toMatch(/always\(\)|failure\(\)|cancelled\(\)/);
          expect((s as Record<string, unknown>)['continue-on-error']).toBeUndefined();
        }
        const ids = job.steps.map((s) => s.id).filter((x): x is string => x !== undefined);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });
});
