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

const monorepoOptions = { appDir: 'apps/mobile', appSlug: 'mobile' };

interface WorkflowYaml {
  on: { push: { branches: string[]; paths?: string[] } };
  defaults?: { run?: { 'working-directory'?: string } };
}

function parseWorkflow(content: string): WorkflowYaml {
  return yaml.load(content) as WorkflowYaml;
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

  test('appDir sets defaults.run.working-directory to the app subdir', () => {
    const { content } = generateGithubActions(baseConfig, monorepoOptions)[0]!;
    const parsed = parseWorkflow(content);
    expect(parsed.defaults?.run?.['working-directory']).toBe('apps/mobile');
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

  test('ota (smart) workflow also gets working-directory and paths filter', () => {
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
    const { content } = generateGithubActions(otaConfig, monorepoOptions)[0]!;
    const parsed = parseWorkflow(content);
    expect(parsed.defaults?.run?.['working-directory']).toBe('apps/mobile');
    expect(parsed.on.push.paths).toEqual(['apps/mobile/**']);
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
