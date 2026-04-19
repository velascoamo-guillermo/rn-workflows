import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig, ConfigError } from '../src/config/parser.ts';

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8');

describe('config parser', () => {
  it('parses preview-android fixture', () => {
    const cfg = parseConfig(fixture('preview-android.yml'));
    expect(cfg.project.type).toBe('expo');
    expect(cfg.ci).toBe('github-actions');
    expect(cfg.build.preview?.platform).toBe('android');
  });

  it('parses production-all fixture', () => {
    const cfg = parseConfig(fixture('production-all.yml'));
    expect(Object.keys(cfg.build)).toEqual(['preview', 'staging', 'production']);
    expect(cfg.build.production?.android?.buildType).toBe('aab');
  });

  it('parses gitlab fixture', () => {
    const cfg = parseConfig(fixture('gitlab-staging.yml'));
    expect(cfg.ci).toBe('gitlab');
  });

  it('rejects missing bundleId', () => {
    const bad = `
project:
  type: expo
  packageName: com.myapp
ci: github-actions
build:
  preview:
    platform: android
    distribution: firebase
`;
    expect(() => parseConfig(bad)).toThrow(ConfigError);
  });

  it('rejects unknown distribution', () => {
    const bad = `
project:
  type: expo
  bundleId: com.myapp
  packageName: com.myapp
ci: github-actions
build:
  preview:
    platform: android
    distribution: slack
`;
    expect(() => parseConfig(bad)).toThrow(/distribution/);
  });

  it('rejects store on android without aab', () => {
    const bad = `
project:
  type: expo
  bundleId: com.myapp
  packageName: com.myapp
ci: github-actions
build:
  production:
    platform: android
    distribution: store
    android:
      buildType: apk
`;
    expect(() => parseConfig(bad)).toThrow(/aab/);
  });

  it('rejects testflight on android-only profile', () => {
    const bad = `
project:
  type: expo
  bundleId: com.myapp
  packageName: com.myapp
ci: github-actions
build:
  preview:
    platform: android
    distribution: testflight
`;
    expect(() => parseConfig(bad)).toThrow(/testflight/);
  });

  it('rejects empty build map', () => {
    const bad = `
project:
  type: expo
  bundleId: com.myapp
  packageName: com.myapp
ci: github-actions
build: {}
`;
    expect(() => parseConfig(bad)).toThrow(/at least one build profile/);
  });
});
