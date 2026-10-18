/**
 * Script-level acceptance for the smart (OTA) workflow: each generated
 * `run:` is extracted from the YAML and executed with bash against fixtures,
 * stub commands, a tmp bare git remote and an in-process HTTP server.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateGithubActions } from '../src/generators/github-actions';
import type { Config } from '../src/config/schema';
import { getStep, parseWorkflow, runStep } from './helpers/run-step';

const fixtures = resolve(import.meta.dir, 'fixtures', 'ota');
const IOS_HASH = '3f9a1c7e5b2d8046a9e1f3c7d25b8e0a4c6f9d12';
const ANDROID_HASH = '9b4e2d7a1f6c0853e7a2b9d4c1f08e6a5d3b7c2e';

const config: Config = {
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
const content = generateGithubActions(config)[0]!.content;

const scratch: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rnw-ota-'));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

/** App dir whose expo-updates CLI prints a log line, then the given fixture as its last line. */
function appWithResolve(fixture: string): string {
  const app = tmp();
  const bin = join(app, 'node_modules', 'expo-updates', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(app, 'node_modules', 'expo-updates', 'package.json'), '{"name":"expo-updates","version":"0.0.0"}');
  const json = readFileSync(join(fixtures, fixture), 'utf8').trim();
  writeFileSync(
    join(bin, 'cli.js'),
    `if (process.argv[2] !== 'runtimeversion:resolve') process.exit(3);\n` +
      `console.log('resolving runtime version for ' + process.argv[4]);\n` +
      `console.log(${JSON.stringify(json)});\n`,
  );
  return app;
}

describe('fingerprint step', () => {
  test('writes the bare single-line hash to GITHUB_OUTPUT', async () => {
    const step = getStep(content, 'fingerprint', 'fp-ios');
    const r = await runStep(step, { cwd: appWithResolve('resolve-ios.json'), env: { RNW_PLATFORM: 'ios' } });
    expect(r.code).toBe(0);
    expect(r.rawOutput).toBe(`hash=${IOS_HASH}\n`);
  });

  test('android step resolves --platform android', async () => {
    const step = getStep(content, 'fingerprint', 'fp-android');
    expect(step.env?.RNW_PLATFORM).toBe('android');
    const r = await runStep(step, { cwd: appWithResolve('resolve-android.json'), env: { RNW_PLATFORM: 'android' } });
    expect(r.code).toBe(0);
    expect(r.outputs.hash).toBe(ANDROID_HASH);
  });

  test('fails when runtimeVersion is null (no fingerprint policy)', async () => {
    const step = getStep(content, 'fingerprint', 'fp-ios');
    const r = await runStep(step, { cwd: appWithResolve('resolve-null.json'), env: { RNW_PLATFORM: 'ios' } });
    expect(r.code).not.toBe(0);
    expect(r.rawOutput).not.toContain('hash=');
  });

  test('fails when runtimeVersion contains unsafe characters', async () => {
    const step = getStep(content, 'fingerprint', 'fp-ios');
    const r = await runStep(step, { cwd: appWithResolve('resolve-unsafe.json'), env: { RNW_PLATFORM: 'ios' } });
    expect(r.code).not.toBe(0);
    expect(r.rawOutput).not.toContain('hash=');
  });
});

describe('per-platform runtimeVersion collision guard', () => {
  test('fails with a fingerprint-policy hint when ios and android resolve to the same value', async () => {
    const step = getStep(content, 'fingerprint', 'fp-distinct');
    const r = await runStep(step, { cwd: tmp(), env: { RNW_IOS_HASH: '1.0.0', RNW_ANDROID_HASH: '1.0.0' } });
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('runtimeVersion: { policy: "fingerprint" }');
  });

  test('passes when the per-platform values differ', async () => {
    const step = getStep(content, 'fingerprint', 'fp-distinct');
    const r = await runStep(step, { cwd: tmp(), env: { RNW_IOS_HASH: IOS_HASH, RNW_ANDROID_HASH: ANDROID_HASH } });
    expect(r.code).toBe(0);
  });
});

describe('native release tag lookup + push', () => {
  function clonedRepo(): { origin: string; work: string } {
    const root = tmp();
    const origin = join(root, 'origin.git');
    const work = join(root, 'work');
    git(root, 'init', '--bare', '-q', origin);
    git(root, 'clone', '-q', origin, work);
    writeFileSync(join(work, 'README'), 'x');
    git(work, 'add', '.');
    git(work, 'commit', '-q', '-m', 'init');
    git(work, 'push', '-q', 'origin', 'HEAD');
    return { origin, work };
  }

  test('native_exists is false until the native job pushes the tag, true after', async () => {
    const { origin, work } = clonedRepo();
    const env = { RNW_TAG_PREFIX: 'rnw/native/production/ios', RNW_HASH: IOS_HASH };
    const lookup = getStep(content, 'fingerprint', 'native-ios');

    const before = await runStep(lookup, { cwd: work, env });
    expect(before.code).toBe(0);
    expect(before.outputs.exists).toBe('false');

    const push = await runStep(getStep(content, 'native-ios', 'tag'), { cwd: work, env });
    expect(push.code).toBe(0);
    expect(git(origin, 'tag', '--list')).toContain(`rnw/native/production/ios/${IOS_HASH}`);

    const after = await runStep(lookup, { cwd: work, env });
    expect(after.code).toBe(0);
    expect(after.outputs.exists).toBe('true');
  });

  test('a tag for another platform or hash does not count', async () => {
    const { work } = clonedRepo();
    git(work, 'tag', `rnw/native/production/android/${IOS_HASH}`);
    git(work, 'push', '-q', 'origin', '--tags');
    const r = await runStep(getStep(content, 'fingerprint', 'native-ios'), {
      cwd: work,
      env: { RNW_TAG_PREFIX: 'rnw/native/production/ios', RNW_HASH: IOS_HASH },
    });
    expect(r.outputs.exists).toBe('false');
  });

  test('native job re-check reports exists=true when another run tagged meanwhile', async () => {
    const { work } = clonedRepo();
    const env = { RNW_TAG_PREFIX: 'rnw/native/production/ios', RNW_HASH: IOS_HASH };
    const recheck = getStep(content, 'native-ios', 'recheck');
    expect((await runStep(recheck, { cwd: work, env })).outputs.exists).toBe('false');
    git(work, 'tag', `rnw/native/production/ios/${IOS_HASH}`);
    git(work, 'push', '-q', 'origin', '--tags');
    git(work, 'tag', '-d', `rnw/native/production/ios/${IOS_HASH}`);
    const r = await runStep(recheck, { cwd: work, env });
    expect(r.code).toBe(0);
    expect(r.outputs.exists).toBe('true');
    expect(r.stdout).toContain('shipping this commit as an OTA update');
  });

  test('tag push is a no-op success when the tag already exists on origin', async () => {
    const { origin, work } = clonedRepo();
    const env = { RNW_TAG_PREFIX: 'rnw/native/production/ios', RNW_HASH: IOS_HASH };
    // Another run tagged a different commit first.
    git(work, 'tag', `rnw/native/production/ios/${IOS_HASH}`);
    git(work, 'push', '-q', 'origin', '--tags');
    const tagged = git(origin, 'rev-parse', `refs/tags/rnw/native/production/ios/${IOS_HASH}`);
    git(work, 'tag', '-d', `rnw/native/production/ios/${IOS_HASH}`);
    writeFileSync(join(work, 'README'), 'y');
    git(work, 'commit', '-q', '-am', 'second');
    const r = await runStep(getStep(content, 'native-ios', 'tag'), { cwd: work, env });
    expect(r.code).toBe(0);
    expect(git(origin, 'rev-parse', `refs/tags/rnw/native/production/ios/${IOS_HASH}`)).toBe(tagged);
  });

  test('lookup fails (not "false") when origin is unreachable', async () => {
    const { work } = clonedRepo();
    git(work, 'remote', 'set-url', 'origin', join(tmp(), 'missing.git'));
    const r = await runStep(getStep(content, 'fingerprint', 'native-ios'), {
      cwd: work,
      env: { RNW_TAG_PREFIX: 'rnw/native/production/ios', RNW_HASH: IOS_HASH },
    });
    expect(r.code).not.toBe(0);
    expect(r.outputs.exists).toBeUndefined();
  });
});

function appWithDist(): string {
  const app = tmp();
  cpSync(join(fixtures, 'dist'), join(app, 'dist'), { recursive: true });
  return app;
}

describe('update id', () => {
  test('equals HashHelper.convertSHA256HashToUUID(sha256(metadata.json))', async () => {
    const app = appWithDist();
    const hex = createHash('sha256').update(readFileSync(join(app, 'dist', 'metadata.json'))).digest('hex');
    const oracle = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    const r = await runStep(getStep(content, 'ota-ios', 'update-id'), { cwd: app });
    expect(r.code).toBe(0);
    expect(r.outputs.update_id).toBe(oracle);
    expect(r.outputs.update_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe('package step', () => {
  test('zip has expoconfig.json (from `expo config --type public --json`) at its root', async () => {
    const app = appWithDist();
    const bin = tmp();
    const stub = `#!/bin/sh\ncase "$*" in *"expo config --type public --json"*) printf '{"name":"stub-app"}\\n' ;; *) exit 9 ;; esac\n`;
    for (const cmd of ['npx', 'bunx', 'yarn']) {
      writeFileSync(join(bin, cmd), stub);
      chmodSync(join(bin, cmd), 0o755);
    }
    const r = await runStep(getStep(content, 'ota-ios', 'package'), { cwd: app, pathDirs: [bin] });
    expect(r.code).toBe(0);
    const list = spawnSync('unzip', ['-Z1', join(app, 'bundle.zip')], { encoding: 'utf8' }).stdout.split('\n');
    expect(list).toContain('expoconfig.json');
    expect(list).toContain('metadata.json');
    const config = spawnSync('unzip', ['-p', join(app, 'bundle.zip'), 'expoconfig.json'], { encoding: 'utf8' }).stdout;
    expect(JSON.parse(config)).toEqual({ name: 'stub-app' });
  });
});

describe('upload step', () => {
  async function upload(platform: 'ios' | 'android', status: number, env: Record<string, string>, pathDirs: string[] = []) {
    const received: Record<string, string> = {};
    let fileName = '';
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const form = await req.formData();
        for (const [k, v] of form.entries()) {
          if (typeof v === 'string') received[k] = v;
          else fileName = v.name;
        }
        return new Response(status === 200 ? '{"ok":true}' : '{"error":"bad"}', { status });
      },
    });
    try {
      const app = tmp();
      writeFileSync(join(app, 'bundle.zip'), 'zip-bytes');
      const r = await runStep(getStep(content, `ota-${platform}`, 'upload'), {
        cwd: app,
        env: {
          RNW_OTA_SERVER: `http://127.0.0.1:${server.port}`,
          RNW_CHANNEL: 'production',
          RNW_HASH: platform === 'ios' ? IOS_HASH : ANDROID_HASH,
          RNW_COMMIT_MESSAGE: 'feat: x',
          OTA_UPLOAD_KEY: 'test-key',
          GITHUB_SHA: 'abc123',
          ...env,
        },
        pathDirs,
      });
      return { r, received, fileName };
    } finally {
      server.stop(true);
    }
  }

  test('sends user strings literally (no curl @file / <file expansion)', async () => {
    const { r, received, fileName } = await upload('ios', 200, { RNW_COMMIT_MESSAGE: '@/etc/passwd' });
    expect(r.code).toBe(0);
    expect(received.commitMessage).toBe('@/etc/passwd');
    expect(fileName).toBe('bundle.zip');
  });

  test('posts the per-platform runtimeVersion, channel, commit hash and upload key', async () => {
    const ios = await upload('ios', 200, {});
    expect(ios.received).toMatchObject({ runtimeVersion: IOS_HASH, channel: 'production', commitHash: 'abc123', uploadKey: 'test-key' });
    const android = await upload('android', 200, {});
    expect(android.received.runtimeVersion).toBe(ANDROID_HASH);
  });

  test('upload key never appears on the curl command line', async () => {
    const bin = tmp();
    const argvLog = join(bin, 'argv.log');
    const realCurl = spawnSync('sh', ['-c', 'command -v curl'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(join(bin, 'curl'), `#!/bin/sh\nprintf '%s\\n' "$@" >> "${argvLog}"\nexec "${realCurl}" "$@"\n`);
    chmodSync(join(bin, 'curl'), 0o755);
    const { r, received } = await upload('ios', 200, { OTA_UPLOAD_KEY: 's3cr3t-key-value' }, [bin]);
    expect(r.code).toBe(0);
    expect(received.uploadKey).toBe('s3cr3t-key-value');
    const argv = readFileSync(argvLog, 'utf8');
    expect(argv).toContain('/api/upload');
    expect(argv).not.toContain('s3cr3t-key-value');
  });

  test('fails the step on HTTP 400 (bad upload key)', async () => {
    const { r } = await upload('ios', 400, {});
    expect(r.code).not.toBe(0);
  });
});

describe('e2e (staging-patched test binary + Maestro)', () => {
  const e2eFixtures = resolve(import.meta.dir, 'fixtures', 'e2e');
  const maestroStub = resolve(import.meta.dir, 'fixtures', 'bin', 'maestro');
  const e2eCfg: Config = {
    ...config,
    build: {
      production: {
        ...config.build.production!,
        ota: { server: 'https://ota.myapp.com', channel: 'production', stagingChannel: 'qa-staging' },
        e2e: { maestro: { flows: '.maestro' } },
      },
    },
  };
  const e2eContent = generateGithubActions(e2eCfg, { scheme: 'OtaAll' })[0]!.content;
  const UPDATE_ID = '0d3f6c1a-2b4e-4c8d-9a7f-1e2d3c4b5a69';

  function binDir(): string {
    const bin = tmp();
    cpSync(maestroStub, join(bin, 'maestro'));
    chmodSync(join(bin, 'maestro'), 0o755);
    return bin;
  }

  test('android manifest patch: staging channel header + 30s launch wait, rest intact', async () => {
    const app = tmp();
    const dir = join(app, 'android', 'app', 'src', 'main');
    mkdirSync(dir, { recursive: true });
    cpSync(join(e2eFixtures, 'AndroidManifest.xml'), join(dir, 'AndroidManifest.xml'));
    const step = getStep(e2eContent, 'ota-android', 'e2e-patch');
    expect(step.env?.RNW_STAGING_CHANNEL).toBe('qa-staging');
    const r = await runStep(step, { cwd: app, env: { RNW_STAGING_CHANNEL: 'qa-staging', RUNNER_TEMP: tmp() } });
    expect(r.code).toBe(0);
    const xml = readFileSync(join(dir, 'AndroidManifest.xml'), 'utf8');
    expect(xml).toContain(
      '<meta-data android:name="expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY" android:value="{&quot;expo-channel-name&quot;:&quot;qa-staging&quot;}"/>',
    );
    expect(xml).toContain('<meta-data android:name="expo.modules.updates.EXPO_UPDATES_LAUNCH_WAIT_MS" android:value="30000"/>');
    expect(xml).not.toContain('production');
    expect(xml).toContain('expo.modules.updates.EXPO_UPDATE_URL');
    expect(xml.match(/UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY/g)).toHaveLength(1);
  });

  test('android manifest patch inserts the meta-data when prebuild did not emit it', async () => {
    const app = tmp();
    const dir = join(app, 'android', 'app', 'src', 'main');
    mkdirSync(dir, { recursive: true });
    const original = readFileSync(join(e2eFixtures, 'AndroidManifest.xml'), 'utf8')
      .split('\n')
      .filter((l) => !l.includes('REQUEST_HEADERS_KEY') && !l.includes('LAUNCH_WAIT_MS'))
      .join('\n');
    writeFileSync(join(dir, 'AndroidManifest.xml'), original);
    const r = await runStep(getStep(e2eContent, 'ota-android', 'e2e-patch'), {
      cwd: app,
      env: { RNW_STAGING_CHANNEL: 'qa-staging', RUNNER_TEMP: tmp() },
    });
    expect(r.code).toBe(0);
    const xml = readFileSync(join(dir, 'AndroidManifest.xml'), 'utf8');
    expect(xml).toContain('&quot;expo-channel-name&quot;:&quot;qa-staging&quot;');
    expect(xml).toContain('EXPO_UPDATES_LAUNCH_WAIT_MS" android:value="30000"');
    expect(xml.indexOf('LAUNCH_WAIT_MS')).toBeLessThan(xml.indexOf('</application>'));
  });

  test.skipIf(process.platform !== 'darwin')('ios plist patch: staging channel header + 30s launch wait', async () => {
    const app = tmp();
    const dir = join(app, 'ios', 'OtaAll', 'Supporting');
    mkdirSync(dir, { recursive: true });
    const plist = join(dir, 'Expo.plist');
    cpSync(join(e2eFixtures, 'Expo.plist'), plist);
    const step = getStep(e2eContent, 'ota-ios', 'e2e-patch');
    const r = await runStep(step, { cwd: app, env: { RNW_SCHEME: 'OtaAll', RNW_STAGING_CHANNEL: 'qa-staging', RUNNER_TEMP: tmp() } });
    expect(r.code).toBe(0);
    const json = spawnSync('plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' }).stdout;
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.EXUpdatesRequestHeaders).toEqual({ 'expo-channel-name': 'qa-staging' });
    expect(parsed.EXUpdatesLaunchWaitMs).toBe(30000);
    expect(parsed.EXUpdatesURL).toBe('https://ota.example.com/api/manifest');
  });

  test('ios patch fails loudly when the plist is missing', async () => {
    const r = await runStep(getStep(e2eContent, 'ota-ios', 'e2e-patch'), {
      cwd: tmp(),
      env: { RNW_SCHEME: 'OtaAll', RNW_STAGING_CHANNEL: 'qa-staging', RUNNER_TEMP: tmp() },
    });
    expect(r.code).not.toBe(0);
  });

  test('expo unpatch restores the pre-patch native file (store binary never patched)', async () => {
    const app = tmp();
    const runnerTemp = tmp();
    const dir = join(app, 'android', 'app', 'src', 'main');
    mkdirSync(dir, { recursive: true });
    const manifest = join(dir, 'AndroidManifest.xml');
    cpSync(join(e2eFixtures, 'AndroidManifest.xml'), manifest);
    const before = readFileSync(manifest, 'utf8');
    const env = { RNW_STAGING_CHANNEL: 'qa-staging', RUNNER_TEMP: runnerTemp };
    expect((await runStep(getStep(e2eContent, 'native-android', 'e2e-patch'), { cwd: app, env })).code).toBe(0);
    expect(readFileSync(manifest, 'utf8')).not.toBe(before);
    expect((await runStep(getStep(e2eContent, 'native-android', 'e2e-unpatch'), { cwd: app, env })).code).toBe(0);
    expect(readFileSync(manifest, 'utf8')).toBe(before);
  });

  test('ios: maestro runs the update-id guard first, then the user flows, both with the update id', async () => {
    const app = tmp();
    const runnerTemp = tmp();
    const log = join(tmp(), 'maestro.log');
    const env = { RUNNER_TEMP: runnerTemp, MAESTRO_LOG: log, RNW_EXPECTED_UPDATE_ID: UPDATE_ID, RNW_UDID: 'SIM-UDID', RNW_FLOWS: '.maestro', RNW_APP_ID: 'com.test.app' };
    expect((await runStep(getStep(e2eContent, 'ota-ios', 'guard-flow'), { cwd: app, env })).code).toBe(0);
    const flow = readFileSync(join(runnerTemp, 'rnw-assert-update.yaml'), 'utf8');
    expect(flow).toContain('appId: ${RNW_APP_ID}');
    expect(flow).toMatch(/- launchApp[\s\S]*- extendedWaitUntil:\n {4}visible:\n {6}id: rnw-update-id\n {6}text: \$\{RNW_EXPECTED_UPDATE_ID\}/);
    const r = await runStep(getStep(e2eContent, 'ota-ios', 'maestro'), { cwd: app, env, pathDirs: [binDir()] });
    expect(r.code).toBe(0);
    const calls = readFileSync(log, 'utf8').split('\n').filter((l) => !l.startsWith('ENV ') && l);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain(`${runnerTemp}/rnw-assert-update.yaml`);
    expect(calls[0]).toContain(`RNW_EXPECTED_UPDATE_ID=${UPDATE_ID}`);
    expect(calls[0]).toContain('--device SIM-UDID');
    expect(calls[1]).toContain('./.maestro');
    expect(calls[1]).toContain(`RNW_EXPECTED_UPDATE_ID=${UPDATE_ID}`);
  });

  test('ios: a red guard stops before the user flows', async () => {
    const runnerTemp = tmp();
    const log = join(tmp(), 'maestro.log');
    const env = { RUNNER_TEMP: runnerTemp, MAESTRO_LOG: log, MAESTRO_STUB_EXIT: '1', RNW_EXPECTED_UPDATE_ID: UPDATE_ID, RNW_UDID: 'X', RNW_FLOWS: '.maestro', RNW_APP_ID: 'com.test.app' };
    const r = await runStep(getStep(e2eContent, 'ota-ios', 'maestro'), { cwd: tmp(), env, pathDirs: [binDir()] });
    expect(r.code).not.toBe(0);
    expect(readFileSync(log, 'utf8')).not.toContain('./.maestro');
  });

  test('android: emulator script installs the apk, then guard, then flows', async () => {
    const app = tmp();
    const runnerTemp = tmp();
    const log = join(tmp(), 'maestro.log');
    const bin = binDir();
    writeFileSync(join(bin, 'adb'), `#!/bin/sh\nprintf 'ADB %s\\n' "$*" >> "$MAESTRO_LOG"\n`);
    chmodSync(join(bin, 'adb'), 0o755);
    const env = { RUNNER_TEMP: runnerTemp, MAESTRO_LOG: log, RNW_EXPECTED_UPDATE_ID: UPDATE_ID, RNW_FLOWS: '.maestro', RNW_APP_ID: 'com.test.app' };
    expect((await runStep(getStep(e2eContent, 'ota-android', 'guard-flow'), { cwd: app, env })).code).toBe(0);
    expect((await runStep(getStep(e2eContent, 'ota-android', 'maestro-script'), { cwd: app, env })).code).toBe(0);
    const emu = parseWorkflow(e2eContent).jobs['ota-android']!.steps.find((s) => s.uses?.startsWith('reactivecircus/'))!;
    expect(emu.env).toMatchObject({ RNW_EXPECTED_UPDATE_ID: '${{ steps.update-id.outputs.update_id }}', RNW_FLOWS: '.maestro' });
    const r = await runStep({ run: String(emu.with?.script) }, { cwd: app, env, pathDirs: [bin] });
    expect(r.code).toBe(0);
    const calls = readFileSync(log, 'utf8').split('\n').filter((l) => !l.startsWith('ENV ') && l);
    expect(calls[0]).toBe(`ADB install -r ${runnerTemp}/rnw-e2e/android/app.apk`);
    expect(calls[1]).toContain('rnw-assert-update.yaml');
    expect(calls[1]).toContain(`RNW_EXPECTED_UPDATE_ID=${UPDATE_ID}`);
    expect(calls[2]).toContain('./.maestro');
  });

  test('native: flows only, no guard, no update id', async () => {
    const log = join(tmp(), 'maestro.log');
    const env = { RUNNER_TEMP: tmp(), MAESTRO_LOG: log, RNW_UDID: 'X', RNW_FLOWS: '.maestro', RNW_APP_ID: 'com.test.app' };
    const r = await runStep(getStep(e2eContent, 'native-ios', 'maestro'), { cwd: tmp(), env, pathDirs: [binDir()] });
    expect(r.code).toBe(0);
    const out = readFileSync(log, 'utf8');
    expect(out.trim().split('\n')).toHaveLength(1);
    expect(out).toContain('./.maestro');
    expect(out).not.toContain('rnw-assert-update');
    expect(out).not.toContain('RNW_EXPECTED_UPDATE_ID');
  });

  test('simulator: RNW_IOS_DEVICE by name, else the first iPhone; UDID exported', async () => {
    const bin = tmp();
    const devices = {
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
          { name: 'iPad Air', udid: 'IPAD-1', isAvailable: true },
          { name: 'iPhone 16', udid: 'IPHONE-16', isAvailable: true },
          { name: 'iPhone 16 Pro Max', udid: 'IPHONE-16PM', isAvailable: true },
        ],
      },
    };
    const xlog = join(bin, 'xcrun.log');
    writeFileSync(join(bin, 'devices.json'), JSON.stringify(devices));
    writeFileSync(
      join(bin, 'xcrun'),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${xlog}"\ncase "$*" in "simctl list devices available -j") cat "${join(bin, 'devices.json')}" ;; esac\n`,
    );
    chmodSync(join(bin, 'xcrun'), 0o755);
    const step = getStep(e2eContent, 'ota-ios', 'simulator');
    const runnerTemp = tmp();
    const first = await runStep(step, { cwd: tmp(), env: { RUNNER_TEMP: runnerTemp }, pathDirs: [bin] });
    expect(first.code).toBe(0);
    expect(first.outputs.udid).toBe('IPHONE-16');
    expect(readFileSync(xlog, 'utf8')).toContain(`simctl install IPHONE-16 ${runnerTemp}/rnw-e2e/ios/app.app`);
    const named = await runStep(step, { cwd: tmp(), env: { RUNNER_TEMP: runnerTemp, RNW_IOS_DEVICE: 'iPhone 16 Pro Max' }, pathDirs: [bin] });
    expect(named.outputs.udid).toBe('IPHONE-16PM');
    const missing = await runStep(step, { cwd: tmp(), env: { RUNNER_TEMP: runnerTemp, RNW_IOS_DEVICE: 'iPhone 3G' }, pathDirs: [bin] });
    expect(missing.code).not.toBe(0);
  });

  test('maestro install is skipped when maestro is already on PATH (self-hosted)', async () => {
    const bin = binDir();
    writeFileSync(join(bin, 'curl'), '#!/bin/sh\necho curl-called >&2\nexit 7\n');
    chmodSync(join(bin, 'curl'), 0o755);
    const ghPath = join(tmp(), 'github_path');
    writeFileSync(ghPath, '');
    const r = await runStep(getStep(e2eContent, 'ota-ios', 'maestro-install'), {
      cwd: tmp(),
      env: { GITHUB_PATH: ghPath, MAESTRO_VERSION: '2.11.0' },
      pathDirs: [bin],
    });
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain('curl-called');
  });

  test('maestro install downloads the pinned version when missing', async () => {
    const bin = tmp();
    const clog = join(bin, 'curl.log');
    writeFileSync(join(bin, 'curl'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${clog}"\nprintf 'echo "installer MAESTRO_VERSION=$MAESTRO_VERSION" >> "${clog}"\\n'\n`);
    chmodSync(join(bin, 'curl'), 0o755);
    const ghPath = join(tmp(), 'github_path');
    writeFileSync(ghPath, '');
    const r = await runStep(getStep(e2eContent, 'ota-ios', 'maestro-install'), {
      cwd: tmp(),
      env: { GITHUB_PATH: ghPath, MAESTRO_VERSION: '2.11.0' },
      pathDirs: [bin],
    });
    if (spawnSync('sh', ['-c', 'command -v maestro']).status === 0) return;
    expect(r.code).toBe(0);
    expect(readFileSync(clog, 'utf8')).toContain('installer MAESTRO_VERSION=2.11.0');
    expect(readFileSync(ghPath, 'utf8')).toContain('.maestro/bin');
  });
});
