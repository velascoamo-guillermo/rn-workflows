import { describe, expect, test } from 'bun:test';
import yaml from 'js-yaml';
import { generateGitlab } from '../src/generators/gitlab';
import type { Config } from '../src/config/schema';

const baseConfig: Config = {
  project: { type: 'bare', bundleId: 'com.test.app', packageName: 'com.test.app' },
  ci: 'gitlab',
  build: {
    preview: { platform: 'android', distribution: 'firebase' },
  },
};

describe('generateGitlab', () => {
  test('outputs single .gitlab-ci.yml file', () => {
    const files = generateGitlab(baseConfig);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('.gitlab-ci.yml');
  });

  test('output is valid YAML', () => {
    const { content } = generateGitlab(baseConfig)[0];
    expect(() => yaml.load(content)).not.toThrow();
  });

  test('android job uses correct image', () => {
    const { content } = generateGitlab(baseConfig)[0];
    expect(content).toContain('reactnativecommunity/react-native-android');
  });

  test('ios job uses macos image', () => {
    const config: Config = {
      ...baseConfig,
      build: { preview: { platform: 'ios', distribution: 'testflight' } },
    };
    const { content } = generateGitlab(config)[0];
    expect(content).toContain('macos-14-xcode-15');
  });

  test('all platform creates two jobs', () => {
    const config: Config = {
      ...baseConfig,
      build: { preview: { platform: 'all', distribution: 'firebase' } },
    };
    const { content } = generateGitlab(config)[0];
    expect(content).toContain('build:preview:android');
    expect(content).toContain('build:preview:ios');
  });

  test('firebase android job includes correct secrets', () => {
    const { content } = generateGitlab(baseConfig)[0];
    expect(content).toContain('FIREBASE_APP_ID_ANDROID');
    expect(content).toContain('FIREBASE_SERVICE_ACCOUNT_JSON');
  });

  test('preview profile targets develop branch', () => {
    const { content } = generateGitlab(baseConfig)[0];
    expect(content).toContain('develop');
  });

  test('production profile targets main branch', () => {
    const config: Config = {
      ...baseConfig,
      build: { production: { platform: 'android', distribution: 'store' } },
    };
    const { content } = generateGitlab(config)[0];
    expect(content).toContain('main');
  });

  test('output matches snapshot', () => {
    const { content } = generateGitlab(baseConfig)[0];
    expect(content).toMatchSnapshot();
  });
});
