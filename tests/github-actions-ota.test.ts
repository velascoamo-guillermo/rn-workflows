import { describe, expect, test } from 'bun:test';
import yaml from 'js-yaml';
import { generateGithubActions } from '../src/generators/github-actions';
import type { Config } from '../src/config/schema';

const baseOtaConfig: Config = {
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

describe('generateGithubActions with OTA', () => {
  test('output is valid YAML', () => {
    const { content } = generateGithubActions(baseOtaConfig)[0]!;
    expect(() => yaml.load(content)).not.toThrow();
  });

  test('includes fingerprint job', () => {
    const { content } = generateGithubActions(baseOtaConfig)[0]!;
    expect(content).toContain('fingerprint:');
    expect(content).toContain('@expo/fingerprint');
  });

  test('includes ota-update job', () => {
    const { content } = generateGithubActions(baseOtaConfig)[0]!;
    expect(content).toContain('ota-update:');
  });

  test('ota-update job posts to configured server', () => {
    const { content } = generateGithubActions(baseOtaConfig)[0]!;
    expect(content).toContain('https://ota.myapp.com/api/upload');
  });

  test('ota-update job uses configured channel', () => {
    const { content } = generateGithubActions(baseOtaConfig)[0]!;
    expect(content).toContain('channel=production');
  });

  test('ota-update job injects OTA_UPLOAD_KEY secret', () => {
    const { content } = generateGithubActions(baseOtaConfig)[0]!;
    expect(content).toContain('OTA_UPLOAD_KEY');
    expect(content).toContain('secrets.OTA_UPLOAD_KEY');
  });

  test('native build jobs are conditioned on native_exists != true', () => {
    const { content } = generateGithubActions(baseOtaConfig)[0]!;
    expect(content).toContain("native_exists != 'true'");
  });

  test('ota-update job is conditioned on native_exists == true', () => {
    const { content } = generateGithubActions(baseOtaConfig)[0]!;
    expect(content).toContain("native_exists == 'true'");
  });

  test('includes save-fingerprint job', () => {
    const { content } = generateGithubActions(baseOtaConfig)[0]!;
    expect(content).toContain('save-fingerprint:');
    expect(content).toContain('actions/cache/save@v4');
  });

  test('profile without ota uses original workflow template', () => {
    const noOtaConfig: Config = {
      project: { type: 'expo', bundleId: 'com.test.app', packageName: 'com.test.app' },
      ci: 'github-actions',
      build: {
        production: { platform: 'android', distribution: 'firebase' },
      },
    };
    const { content } = generateGithubActions(noOtaConfig)[0]!;
    expect(content).not.toContain('fingerprint:');
    expect(content).not.toContain('ota-update:');
  });

  test('platform:all uploads the universal bundle exactly once per run', () => {
    // OTA upload runs once per app: `expo export --platform all` produces a
    // universal bundle, so a second per-platform upload would be a duplicate.
    const { content } = generateGithubActions(baseOtaConfig)[0]!;
    expect(content.match(/Upload OTA update/g)).toHaveLength(1);
    expect(content.match(/npx expo export --platform all/g)).toHaveLength(1);
  });

  test('output matches snapshot', () => {
    const { content } = generateGithubActions(baseOtaConfig)[0]!;
    expect(content).toMatchSnapshot();
  });
});
