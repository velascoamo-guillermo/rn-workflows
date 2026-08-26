import { afterAll, describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../src/config/types.ts';
import type { SetupContext } from '../src/setup/types.ts';

describe('collectRequiredSecrets', () => {
  it('returns firebase secrets for android firebase profile', async () => {
    const { collectRequiredSecrets } = await import('../src/setup/secrets.ts');
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

  it('includes ios signing secrets for ios builds', async () => {
    const { collectRequiredSecrets } = await import('../src/setup/secrets.ts');
    const config: Config = {
      project: { type: 'expo', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'github-actions',
      build: { staging: { platform: 'ios', distribution: 'firebase' } },
    };
    const secrets = collectRequiredSecrets(config);
    expect(secrets).toContain('MATCH_PASSWORD');
    expect(secrets).toContain('MATCH_GIT_URL');
  });

  it('deduplicates secrets across profiles', async () => {
    const { collectRequiredSecrets } = await import('../src/setup/secrets.ts');
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

/**
 * #34 review — Important: the test that used to sit here just restated
 * collectRequiredSecrets in terms of deriveRequiredSecrets
 * (`expect(collectRequiredSecrets(config)).toEqual(deriveRequiredSecrets(config)...)`)
 * — a tautology against the production implementation (`collectRequiredSecrets`
 * literally *is* `requiredOnly(deriveRequiredSecrets(config)).map(...)`), so it
 * could never fail on a real regression.
 *
 * Replaced with a collectability assertion driven through the real step
 * pipeline (mocking only the gh CLI and interactive prompts, same approach
 * as tests/setup-secrets-e2e.test.ts): for each fixture config, running
 * every setup step in order must never throw, and every required secret
 * must end up either actually collected or on the printed missing-secrets
 * checklist — never silently dropped by both.
 *
 * The mock.module calls below are module-scoped (not inside `describe`,
 * which isn't an async context and can't `await import`) and restored in
 * `afterAll`, same isolation fix applied to tests/setup-appstore.test.ts —
 * mock.module patches the shared bun:test module registry for the whole
 * process, not just this file.
 */

const promptTextQueue: string[] = [];
const promptConfirmQueue: boolean[] = [];

const realPrompts = await import('../src/setup/prompts.ts');
const realShell = await import('../src/setup/shell.ts');

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
  isAvailable: (cmd: string) => cmd === 'gh',
  shell: (cmd: string, args: string[]) => {
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

const tmpDir = mkdtempSync(join(tmpdir(), 'rnwf-setup-secrets-test-'));
const keyPath = join(tmpDir, 'key.p8');
writeFileSync(keyPath, '-----BEGIN PRIVATE KEY-----\nfakekey\n-----END PRIVATE KEY-----\n');

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  mock.module('../src/setup/prompts.ts', () => realPrompts);
  mock.module('../src/setup/shell.ts', () => realShell);
});

async function runAllSteps(ctx: SetupContext): Promise<void> {
  await runSteps(
    [makeFirebaseAppsStep(), makeServiceAccountStep(), makeMatchRepoStep(), makeAppStoreStep(), makePlayStoreStep()],
    ctx,
  );
  await makeSecretsStep().run(ctx);
}

describe('setup steps are collectability-complete for their required secrets (#34)', () => {
  it('ios/testflight/github: collects everything but MATCH_GIT_BASIC_AUTHORIZATION, which is checklisted', async () => {
    const config: Config = {
      project: { type: 'bare', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'github-actions',
      build: { production: { platform: 'ios', distribution: 'testflight' } },
    };
    const ctx: SetupContext = {
      config,
      dryRun: false,
      githubRepo: 'owner/repo',
      matchRepoName: 'test-match',
      // MATCH_PASSWORD is collected by the setup.ts wizard, not a step —
      // seed it here to mirror that.
      collectedSecrets: { MATCH_PASSWORD: 'shh' },
    };
    promptTextQueue.push('ABCD1234EF', 'KEYID123', 'ISSUER-UUID', keyPath);
    promptConfirmQueue.push(false);

    await runAllSteps(ctx);

    const required = collectRequiredSecrets(config);
    const collected = required.filter((name) => ctx.collectedSecrets[name] !== undefined);
    const missing = required.filter((name) => ctx.collectedSecrets[name] === undefined);

    expect(missing).toEqual(['MATCH_GIT_BASIC_AUTHORIZATION']);
    expect([...collected, ...missing].sort()).toEqual([...required].sort());
  });

  it('android firebase+github-releases/github: every required secret is collectible, none missing', async () => {
    const config: Config = {
      project: { type: 'bare', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'github-actions',
      build: { production: { platform: 'android', distribution: 'firebase+github-releases' } },
    };
    const ctx: SetupContext = {
      config,
      dryRun: false,
      githubRepo: 'owner/repo',
      // GITHUB_TOKEN is collected by the setup.ts wizard, not a step.
      collectedSecrets: { GITHUB_TOKEN: 'ghp_test' },
    };
    promptTextQueue.push('firebase-app-id-android', 'firebase-service-account-json');

    await runAllSteps(ctx);

    const required = collectRequiredSecrets(config);
    const collected = required.filter((name) => ctx.collectedSecrets[name] !== undefined);
    const missing = required.filter((name) => ctx.collectedSecrets[name] === undefined);

    expect(missing).toEqual([]);
    expect([...collected, ...missing].sort()).toEqual([...required].sort());
  });
});
