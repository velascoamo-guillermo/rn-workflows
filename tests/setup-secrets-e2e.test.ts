import { afterAll, describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../src/config/types.ts';
import type { SetupContext } from '../src/setup/types.ts';

/**
 * #34 review — Critical: `makeSecretsStep` used to `throw` whenever any
 * required secret wasn't collected first, which aborted the whole `setup`
 * run with a non-zero exit even though every other secret it *could*
 * collect had already been uploaded successfully. On a plain ios/testflight
 * config over GitHub Actions, `MATCH_GIT_BASIC_AUTHORIZATION` has no
 * interactive collector anywhere in `src/setup/*` (it's a base64
 * `user:token` pair, not something to prompt for blindly) — so setup was
 * *guaranteed* to abort on that config today.
 *
 * The fix: never throw for missing-but-required secrets. Upload whatever
 * was collected, then report the rest as a checklist. This file drives that
 * fix end-to-end through the real step pipeline (mocking only the
 * gh/glab CLI calls and the interactive prompts), not just unit-level
 * against `makeSecretsStep` in isolation.
 */

const promptTextQueue: string[] = [];
const promptConfirmQueue: boolean[] = [];

const realPrompts = await import('../src/setup/prompts.ts');
const realShell = await import('../src/setup/shell.ts');

const shellCalls: Array<{ cmd: string; args: string[] }> = [];

mock.module('../src/setup/prompts.ts', () => ({
  promptText: async (_message: string) => {
    const next = promptTextQueue.shift();
    if (next === undefined) throw new Error('promptText called with an empty queue');
    return next;
  },
  promptConfirm: async (_message: string) => {
    const next = promptConfirmQueue.shift();
    if (next === undefined) throw new Error('promptConfirm called with an empty queue');
    return next;
  },
  promptPassword: async () => {
    throw new Error('promptPassword not stubbed for this test');
  },
}));

mock.module('../src/setup/shell.ts', () => ({
  isAvailable: (cmd: string) => cmd === 'gh' || cmd === 'glab',
  shell: (cmd: string, args: string[]) => {
    shellCalls.push({ cmd, args });
    if (cmd === 'gh' && args[0] === 'repo' && args[1] === 'view') {
      return { stdout: '', stderr: 'not found', exitCode: 1 };
    }
    if (cmd === 'gh' && args[0] === 'repo' && args[1] === 'create') {
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    if (cmd === 'gh' && args[0] === 'secret' && args[1] === 'list') {
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    if (cmd === 'gh' && args[0] === 'secret' && args[1] === 'set') {
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  },
}));

const { makeFirebaseAppsStep, makeServiceAccountStep } = await import('../src/setup/firebase.ts');
const { makeMatchRepoStep } = await import('../src/setup/match.ts');
const { makeAppStoreStep } = await import('../src/setup/appstore.ts');
const { makePlayStoreStep } = await import('../src/setup/playstore.ts');
const { makeSecretsStep, collectRequiredSecrets } = await import('../src/setup/secrets.ts');
const { runSteps } = await import('../src/setup/runner.ts');

const tmpDir = mkdtempSync(join(tmpdir(), 'rnwf-setup-e2e-'));
const keyPath = join(tmpDir, 'key.p8');
writeFileSync(keyPath, '-----BEGIN PRIVATE KEY-----\nfakekey\n-----END PRIVATE KEY-----\n');

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  // Isolate: restore the real modules so later test files in the same bun
  // test process don't see these stubs (see #34 review minor item on
  // tests/setup-appstore.test.ts for the same class of leak).
  mock.module('../src/setup/prompts.ts', () => realPrompts);
  mock.module('../src/setup/shell.ts', () => realShell);
});

function baseCtx(config: Config): SetupContext {
  return {
    config,
    dryRun: false,
    githubRepo: 'owner/repo',
    matchRepoName: 'test-match',
    collectedSecrets: {},
  };
}

describe('setup never aborts on uncollectable required secrets (#34 critical)', () => {
  it('completes end-to-end on an ios/testflight/github fixture: uploads what it collected, checklists the rest', async () => {
    const config: Config = {
      project: { type: 'bare', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'github-actions',
      build: { production: { platform: 'ios', distribution: 'testflight' } },
    };
    const ctx = baseCtx(config);
    // MATCH_PASSWORD is collected by the setup.ts wizard before steps run,
    // not by a step — seed it here to mirror that.
    ctx.collectedSecrets['MATCH_PASSWORD'] = 'shh';

    promptTextQueue.push('ABCD1234EF', 'KEYID123', 'ISSUER-UUID', keyPath);
    promptConfirmQueue.push(false);

    const collectorSteps = [
      makeFirebaseAppsStep(),
      makeServiceAccountStep(),
      makeMatchRepoStep(),
      makeAppStoreStep(),
      makePlayStoreStep(),
    ];
    await runSteps(collectorSteps, ctx);

    // RED (pre-fix): the line below throws "Missing values for secrets:
    // MATCH_GIT_BASIC_AUTHORIZATION" and the test never reaches its
    // assertions.
    const result = await makeSecretsStep().run(ctx);

    // Uploads happened for everything the earlier steps could collect.
    const setCalls = shellCalls.filter((c) => c.cmd === 'gh' && c.args[0] === 'secret' && c.args[1] === 'set');
    expect(setCalls.length).toBeGreaterThan(0);
    expect(setCalls.some((c) => c.args[2] === 'MATCH_GIT_URL')).toBe(true);
    expect(setCalls.some((c) => c.args[2] === 'APPLE_TEAM_ID')).toBe(true);
    expect(ctx.collectedSecrets['MATCH_GIT_URL']).toBeDefined();
    expect(ctx.collectedSecrets['APPLE_TEAM_ID']).toBe('ABCD1234EF');

    // The one secret nothing in `setup` collects for this config is
    // checklisted, not thrown.
    const required = collectRequiredSecrets(config);
    expect(required).toContain('MATCH_GIT_BASIC_AUTHORIZATION');
    expect(result.note).toContain('MATCH_GIT_BASIC_AUTHORIZATION');
  });
});
