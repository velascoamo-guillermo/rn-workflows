import { describe, expect, it } from 'bun:test';
import { runSteps } from '../src/setup/runner.ts';
import type { Step, SetupContext } from '../src/setup/types.ts';

const ctx: SetupContext = {
  config: {
    project: { type: 'expo', bundleId: 'com.test', packageName: 'com.test' },
    ci: 'github-actions',
    build: { staging: { platform: 'android', distribution: 'firebase' } },
  },
  dryRun: false,
  githubRepo: 'owner/repo',
  collectedSecrets: {},
};

describe('runSteps', () => {
  it('executes steps in order', async () => {
    const order: string[] = [];
    const steps: Step[] = [
      { id: 'a', label: 'Step A', run: async () => { order.push('a'); return { skipped: false }; } },
      { id: 'b', label: 'Step B', run: async () => { order.push('b'); return { skipped: false }; } },
    ];
    await runSteps(steps, ctx);
    expect(order).toEqual(['a', 'b']);
  });

  it('continues after skipped step', async () => {
    const order: string[] = [];
    const steps: Step[] = [
      { id: 'a', label: 'Skip me', run: async () => { order.push('a'); return { skipped: true }; } },
      { id: 'b', label: 'Run me', run: async () => { order.push('b'); return { skipped: false }; } },
    ];
    await runSteps(steps, ctx);
    expect(order).toEqual(['a', 'b']);
  });

  it('stops on step error', async () => {
    const order: string[] = [];
    const steps: Step[] = [
      { id: 'a', label: 'Fail', run: async () => { order.push('a'); throw new Error('oops'); } },
      { id: 'b', label: 'Never', run: async () => { order.push('b'); return { skipped: false }; } },
    ];
    await expect(runSteps(steps, ctx)).rejects.toThrow('oops');
    expect(order).toEqual(['a']);
  });

  it('skips run() in dry-run mode', async () => {
    const ran: string[] = [];
    const dryCtx = { ...ctx, dryRun: true };
    const steps: Step[] = [
      { id: 'a', label: 'Would run', run: async () => { ran.push('a'); return { skipped: false }; } },
    ];
    await runSteps(steps, dryCtx);
    expect(ran).toEqual([]);
  });
});
