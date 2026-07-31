import { describe, expect, test } from 'bun:test';
import yaml from 'js-yaml';
import { generateGithubActions } from '../src/generators/github-actions';
import type { Config } from '../src/config/schema';

const baseConfig: Config = {
  project: { type: 'bare', bundleId: 'com.test.app', packageName: 'com.test.app' },
  ci: 'github-actions',
  build: {
    preview: { platform: 'android', distribution: 'firebase' },
  },
};

const otaConfig: Config = {
  ...baseConfig,
  project: { type: 'expo', bundleId: 'com.test.app', packageName: 'com.test.app' },
  build: {
    production: {
      platform: 'all',
      distribution: 'store',
      android: { buildType: 'aab' },
      ota: { server: 'https://ota.myapp.com', channel: 'production' },
    },
  },
};

const monorepoOptions = { appDir: 'apps/mobile', appSlug: 'mobile' };

interface StepYaml {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

interface JobYaml {
  defaults?: { run?: { 'working-directory'?: string } };
  steps: StepYaml[];
}

interface WorkflowYaml {
  on: { push: { branches: string[]; paths?: string[] } };
  defaults?: { run?: { 'working-directory'?: string } };
  jobs: Record<string, JobYaml>;
}

function parseWorkflow(content: string): WorkflowYaml {
  return yaml.load(content) as WorkflowYaml;
}

function findStep(job: JobYaml, usesPrefix: string): StepYaml | undefined {
  return job.steps.find((s) => s.uses?.startsWith(usesPrefix));
}

describe('generateGithubActions in a monorepo', () => {
  test('default options emit no working-directory and no paths filter (non-monorepo unchanged)', () => {
    const { content } = generateGithubActions(baseConfig)[0]!;
    expect(content).not.toContain('working-directory');
    expect(content).not.toContain('paths:');
    const parsed = parseWorkflow(content);
    expect(parsed.defaults).toBeUndefined();
    expect(parsed.on.push.paths).toBeUndefined();
  });

  test('appDir does NOT set a global defaults.run.working-directory', () => {
    const { content } = generateGithubActions(baseConfig, monorepoOptions)[0]!;
    const parsed = parseWorkflow(content);
    expect(parsed.defaults).toBeUndefined();
  });

  test('appDir sets per-job working-directory on jobs that check out code', () => {
    const config: Config = {
      ...baseConfig,
      checks: { test: true },
    };
    const { content } = generateGithubActions(config, monorepoOptions)[0]!;
    const parsed = parseWorkflow(content);
    for (const [id, job] of Object.entries(parsed.jobs)) {
      const checksOut = job.steps.some((s) => s.uses?.startsWith('actions/checkout'));
      expect(checksOut).toBe(true);
      expect(job.defaults?.run?.['working-directory']).toBe('apps/mobile');
    }
    expect(Object.keys(parsed.jobs)).toEqual(['quality', 'build-android']);
  });

  test('appDir adds on.push.paths filter scoped to the app subdir', () => {
    const { content } = generateGithubActions(baseConfig, monorepoOptions)[0]!;
    const parsed = parseWorkflow(content);
    expect(parsed.on.push.paths).toEqual(['apps/mobile/**']);
  });

  test('appSlug prefixes the emitted filename', () => {
    const files = generateGithubActions(baseConfig, monorepoOptions);
    expect(files[0]!.path).toBe('.github/workflows/rn-mobile-preview.yml');
  });

  test('workflowsDir option relocates emitted files', () => {
    const files = generateGithubActions(baseConfig, {
      ...monorepoOptions,
      workflowsDir: '/repo/.github/workflows',
    });
    expect(files[0]!.path).toBe('/repo/.github/workflows/rn-mobile-preview.yml');
  });

  test('monorepo output is valid YAML', () => {
    const { content } = generateGithubActions(baseConfig, monorepoOptions)[0]!;
    expect(() => yaml.load(content)).not.toThrow();
  });

  test('setup-ruby gets a working-directory input in monorepo mode', () => {
    const { content } = generateGithubActions(baseConfig, monorepoOptions)[0]!;
    const parsed = parseWorkflow(content);
    const ruby = findStep(parsed.jobs['build-android']!, 'ruby/setup-ruby');
    expect(ruby).toBeDefined();
    expect(ruby!.with?.['working-directory']).toBe('apps/mobile');
  });

  test('setup-ruby has no working-directory input outside monorepo mode', () => {
    const { content } = generateGithubActions(baseConfig)[0]!;
    const parsed = parseWorkflow(content);
    const ruby = findStep(parsed.jobs['build-android']!, 'ruby/setup-ruby');
    expect(ruby).toBeDefined();
    expect(ruby!.with?.['working-directory']).toBeUndefined();
  });

  test('setup-node cache gets cache-dependency-path in monorepo mode (npm and yarn)', () => {
    const npmContent = generateGithubActions(baseConfig, {
      ...monorepoOptions,
      packageManager: 'npm',
    })[0]!.content;
    const npmNode = findStep(parseWorkflow(npmContent).jobs['build-android']!, 'actions/setup-node');
    expect(npmNode!.with?.['cache-dependency-path']).toBe('apps/mobile/package-lock.json');

    const yarnContent = generateGithubActions(baseConfig, {
      ...monorepoOptions,
      packageManager: 'yarn',
    })[0]!.content;
    const yarnNode = findStep(parseWorkflow(yarnContent).jobs['build-android']!, 'actions/setup-node');
    expect(yarnNode!.with?.['cache-dependency-path']).toBe('apps/mobile/yarn.lock');
  });

  test('setup-node cache has no cache-dependency-path outside monorepo mode', () => {
    const { content } = generateGithubActions(baseConfig, { packageManager: 'npm' })[0]!;
    const node = findStep(parseWorkflow(content).jobs['build-android']!, 'actions/setup-node');
    expect(node!.with?.['cache-dependency-path']).toBeUndefined();
  });

  describe('smart (OTA) workflow', () => {
    test('does NOT set a global defaults.run.working-directory', () => {
      const { content } = generateGithubActions(otaConfig, monorepoOptions)[0]!;
      const parsed = parseWorkflow(content);
      expect(parsed.defaults).toBeUndefined();
      expect(parsed.on.push.paths).toEqual(['apps/mobile/**']);
    });

    test('sets per-job working-directory only on jobs that check out code', () => {
      const { content } = generateGithubActions(otaConfig, monorepoOptions)[0]!;
      const parsed = parseWorkflow(content);
      for (const [id, job] of Object.entries(parsed.jobs)) {
        const checksOut = job.steps.some((s) => s.uses?.startsWith('actions/checkout'));
        if (checksOut) {
          expect(job.defaults?.run?.['working-directory']).toBe('apps/mobile');
        } else {
          expect(job.defaults).toBeUndefined();
        }
      }
      expect(parsed.jobs['save-fingerprint']!.defaults).toBeUndefined();
      expect(parsed.jobs['fingerprint']!.defaults?.run?.['working-directory']).toBe('apps/mobile');
      expect(parsed.jobs['ota-update']!.defaults?.run?.['working-directory']).toBe('apps/mobile');
      expect(parsed.jobs['build-ios']!.defaults?.run?.['working-directory']).toBe('apps/mobile');
      expect(parsed.jobs['build-android']!.defaults?.run?.['working-directory']).toBe('apps/mobile');
    });

    test('save-fingerprint job has no checkout step', () => {
      const { content } = generateGithubActions(otaConfig, monorepoOptions)[0]!;
      const parsed = parseWorkflow(content);
      const job = parsed.jobs['save-fingerprint']!;
      expect(findStep(job, 'actions/checkout')).toBeUndefined();
    });

    test('actions/cache paths are prefixed with the app dir and match the written marker', () => {
      const { content } = generateGithubActions(otaConfig, monorepoOptions)[0]!;
      const parsed = parseWorkflow(content);

      const check = findStep(parsed.jobs['fingerprint']!, 'actions/cache');
      expect(check!.with?.path).toBe('apps/mobile/.rn-fingerprint');

      const save = findStep(parsed.jobs['save-fingerprint']!, 'actions/cache/save');
      expect(save!.with?.path).toBe('apps/mobile/.rn-fingerprint');

      const marker = parsed.jobs['save-fingerprint']!.steps.find((s) => s.run?.includes('mkdir'));
      expect(marker!.run).toContain('mkdir -p apps/mobile/.rn-fingerprint');
      expect(marker!.run).toContain('> apps/mobile/.rn-fingerprint/hash');
    });

    test('cache paths stay unprefixed outside monorepo mode', () => {
      const { content } = generateGithubActions(otaConfig)[0]!;
      const parsed = parseWorkflow(content);
      const check = findStep(parsed.jobs['fingerprint']!, 'actions/cache');
      expect(check!.with?.path).toBe('.rn-fingerprint');
      const save = findStep(parsed.jobs['save-fingerprint']!, 'actions/cache/save');
      expect(save!.with?.path).toBe('.rn-fingerprint');
      const marker = parsed.jobs['save-fingerprint']!.steps.find((s) => s.run?.includes('mkdir'));
      expect(marker!.run).toContain('mkdir -p .rn-fingerprint');
    });

    test('setup-ruby in build jobs gets working-directory input in monorepo mode', () => {
      const { content } = generateGithubActions(otaConfig, monorepoOptions)[0]!;
      const parsed = parseWorkflow(content);
      for (const id of ['build-ios', 'build-android']) {
        const ruby = findStep(parsed.jobs[id]!, 'ruby/setup-ruby');
        expect(ruby!.with?.['working-directory']).toBe('apps/mobile');
      }
    });
  });

  test('multiple profiles all get the slug prefix', () => {
    const config: Config = {
      ...baseConfig,
      build: {
        preview: { platform: 'android', distribution: 'firebase' },
        production: { platform: 'ios', distribution: 'store' },
      },
    };
    const paths = generateGithubActions(config, monorepoOptions).map((f) => f.path);
    expect(paths).toContain('.github/workflows/rn-mobile-preview.yml');
    expect(paths).toContain('.github/workflows/rn-mobile-production.yml');
  });
});
