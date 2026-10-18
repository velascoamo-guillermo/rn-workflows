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
import { getStep, runStep } from './helpers/run-step';

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
  async function upload(platform: 'ios' | 'android', status: number, env: Record<string, string>) {
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

  test('fails the step on HTTP 400 (bad upload key)', async () => {
    const { r } = await upload('ios', 400, {});
    expect(r.code).not.toBe(0);
  });
});
