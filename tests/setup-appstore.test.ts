import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as realFs from 'node:fs';
import type { Config } from '../src/config/types.ts';
import type { SetupContext } from '../src/setup/types.ts';
import { collectRequiredSecrets } from '../src/setup/secrets.ts';

/**
 * src/setup/appstore.ts is the only runtime path that collects ASC_* values
 * interactively (#38 review: zero test coverage on it). It talks to
 * @clack/prompts (via ./prompts.ts) and the real filesystem, so both are
 * mocked out via `mock.module` before the module under test is imported.
 */

const promptTextQueue: string[] = [];
const promptConfirmQueue: boolean[] = [];
const fsState: { exists: boolean; content: string } = { exists: true, content: '-----BEGIN PRIVATE KEY-----\nfakekey\n-----END PRIVATE KEY-----\n' };

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
}));

mock.module('node:fs', () => ({
  ...realFs,
  existsSync: (_p: string) => fsState.exists,
  readFileSync: (_p: string, _enc?: string) => fsState.content,
}));

const { makeAppStoreStep } = await import('../src/setup/appstore.ts');

function baseCtx(config: Config): SetupContext {
  return { config, dryRun: false, collectedSecrets: {} };
}

const testflightConfig: Config = {
  project: { type: 'bare', bundleId: 'com.test', packageName: 'com.test' },
  ci: 'github-actions',
  build: { production: { platform: 'ios', distribution: 'testflight' } },
};

describe('makeAppStoreStep (#34)', () => {
  beforeEach(() => {
    promptTextQueue.length = 0;
    promptConfirmQueue.length = 0;
    fsState.exists = true;
    fsState.content = '-----BEGIN PRIVATE KEY-----\nfakekey\n-----END PRIVATE KEY-----\n';
  });

  it('skips when no build profile needs App Store Connect', async () => {
    const androidOnly: Config = {
      project: { type: 'bare', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'github-actions',
      build: { staging: { platform: 'android', distribution: 'firebase' } },
    };
    const result = await makeAppStoreStep().run(baseCtx(androidOnly));
    expect(result.skipped).toBe(true);
  });

  it('stores the raw key and ASC_KEY_IS_BASE64=false when the user declines base64', async () => {
    promptTextQueue.push('ABCD1234EF', 'KEYID123', 'ISSUER-UUID', '/tmp/key.p8');
    promptConfirmQueue.push(false);

    const ctx = baseCtx(testflightConfig);
    const result = await makeAppStoreStep().run(ctx);

    expect(result.skipped).toBe(false);
    expect(ctx.collectedSecrets['APPLE_TEAM_ID']).toBe('ABCD1234EF');
    expect(ctx.collectedSecrets['ASC_KEY_ID']).toBe('KEYID123');
    expect(ctx.collectedSecrets['ASC_ISSUER_ID']).toBe('ISSUER-UUID');
    expect(ctx.collectedSecrets['ASC_KEY_CONTENT']).toBe(fsState.content);
    expect(ctx.collectedSecrets['ASC_KEY_IS_BASE64']).toBe('false');
  });

  it('base64-encodes the key and sets ASC_KEY_IS_BASE64=true when the user opts in', async () => {
    promptTextQueue.push('ABCD1234EF', 'KEYID123', 'ISSUER-UUID', '/tmp/key.p8');
    promptConfirmQueue.push(true);

    const ctx = baseCtx(testflightConfig);
    await makeAppStoreStep().run(ctx);

    expect(ctx.collectedSecrets['ASC_KEY_IS_BASE64']).toBe('true');
    expect(ctx.collectedSecrets['ASC_KEY_CONTENT']).toBe(
      Buffer.from(fsState.content, 'utf8').toString('base64'),
    );
    // sanity: decoding gets the original PEM back
    expect(Buffer.from(ctx.collectedSecrets['ASC_KEY_CONTENT']!, 'base64').toString('utf8')).toBe(
      fsState.content,
    );
  });

  it('throws when the .p8 path does not exist', async () => {
    promptTextQueue.push('ABCD1234EF', 'KEYID123', 'ISSUER-UUID', '/tmp/missing.p8');
    fsState.exists = false;

    await expect(makeAppStoreStep().run(baseCtx(testflightConfig))).rejects.toThrow('File not found');
  });

  // #38 review item 2: zero test coverage meant name drift between what this
  // step collects and what collectRequiredSecrets (the single source of
  // truth since #34) actually demands would only surface at runtime. Pin
  // the two together so it fails in CI instead.
  it('collects exactly the APPLE_TEAM_ID/ASC_* names collectRequiredSecrets demands for this config', async () => {
    promptTextQueue.push('ABCD1234EF', 'KEYID123', 'ISSUER-UUID', '/tmp/key.p8');
    promptConfirmQueue.push(false);

    const ctx = baseCtx(testflightConfig);
    await makeAppStoreStep().run(ctx);

    const appStoreConnectNames = collectRequiredSecrets(testflightConfig).filter(
      (name) => name === 'APPLE_TEAM_ID' || name.startsWith('ASC_'),
    );
    expect(Object.keys(ctx.collectedSecrets).sort()).toEqual(appStoreConnectNames.sort());
  });
});
