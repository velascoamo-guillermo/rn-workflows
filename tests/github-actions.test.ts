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

describe('generateGithubActions', () => {
  test('outputs one file per build profile', () => {
    const files = generateGithubActions(baseConfig);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('.github/workflows/rn-preview.yml');
  });

  test('output is valid YAML', () => {
    const { content } = generateGithubActions(baseConfig)[0];
    expect(() => yaml.load(content)).not.toThrow();
  });

  test('multiple profiles generate multiple files', () => {
    const config: Config = {
      ...baseConfig,
      build: {
        preview: { platform: 'android', distribution: 'firebase' },
        production: { platform: 'ios', distribution: 'store' },
      },
    };
    const files = generateGithubActions(config);
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.path)).toContain('.github/workflows/rn-preview.yml');
    expect(files.map((f) => f.path)).toContain('.github/workflows/rn-production.yml');
  });

  test('android job runs on ubuntu', () => {
    const { content } = generateGithubActions(baseConfig)[0];
    expect(content).toContain('ubuntu-latest');
  });

  test('ios job runs on macos', () => {
    const config: Config = {
      ...baseConfig,
      build: { preview: { platform: 'ios', distribution: 'testflight' } },
    };
    const { content } = generateGithubActions(config)[0];
    expect(content).toContain('macos-latest');
  });

  test('all platform creates android and ios jobs in one file', () => {
    const config: Config = {
      ...baseConfig,
      build: { preview: { platform: 'all', distribution: 'firebase' } },
    };
    const files = generateGithubActions(config);
    expect(files).toHaveLength(1);
    const { content } = files[0];
    expect(content).toContain('build-android');
    expect(content).toContain('build-ios');
  });

  test('firebase android secrets injected as env vars', () => {
    const { content } = generateGithubActions(baseConfig)[0];
    expect(content).toContain('FIREBASE_APP_ID_ANDROID');
    expect(content).toContain('secrets.FIREBASE_APP_ID_ANDROID');
  });

  test('preview branch targets develop', () => {
    const { content } = generateGithubActions(baseConfig)[0];
    expect(content).toContain('develop');
  });

  test('workflow name includes profile name', () => {
    const { content } = generateGithubActions(baseConfig)[0];
    expect(content).toContain('preview');
  });

  test('android job includes JDK setup step', () => {
    const { content } = generateGithubActions(baseConfig)[0];
    expect(content).toContain('setup-java');
  });

  test('ios job does not include JDK setup step', () => {
    const config: Config = {
      ...baseConfig,
      build: { preview: { platform: 'ios', distribution: 'testflight' } },
    };
    const { content } = generateGithubActions(config)[0];
    expect(content).not.toContain('setup-java');
  });

  test('ios job includes setup-xcode step', () => {
    const config: Config = {
      ...baseConfig,
      build: { preview: { platform: 'ios', distribution: 'testflight' } },
    };
    const { content } = generateGithubActions(config)[0];
    expect(content).toContain('maxim-lobanov/setup-xcode@v1');
    expect(content).toContain('xcode-version: latest-stable');
  });

  test('android job does not include setup-xcode step', () => {
    const { content } = generateGithubActions(baseConfig)[0];
    expect(content).not.toContain('setup-xcode');
  });

  test('output matches snapshot', () => {
    const { content } = generateGithubActions(baseConfig)[0];
    expect(content).toMatchSnapshot();
  });

  test('ios output matches snapshot', () => {
    const config: Config = {
      ...baseConfig,
      build: { preview: { platform: 'ios', distribution: 'testflight' } },
    };
    const { content } = generateGithubActions(config)[0];
    expect(content).toMatchSnapshot();
  });

  test('bun project uses bun install and setup-bun action', () => {
    const { content } = generateGithubActions(baseConfig, { packageManager: 'bun' })[0];
    expect(content).toContain('bun install --frozen-lockfile');
    expect(content).toContain('oven-sh/setup-bun@v2');
    expect(content).not.toContain('cache: bun');
    expect(content).not.toContain('yarn install');
  });

  test('npm project uses npm ci and npm cache', () => {
    const { content } = generateGithubActions(baseConfig, { packageManager: 'npm' })[0];
    expect(content).toContain('npm ci');
    expect(content).toContain('cache: npm');
  });
});
