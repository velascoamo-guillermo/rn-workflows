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

  it('parses ci as object with provider and workflowsDir', () => {
    const raw = `
project:
  type: expo
  bundleId: com.myapp
  packageName: com.myapp
ci:
  provider: github-actions
  workflowsDir: ../../.github/workflows
build:
  preview:
    platform: android
    distribution: firebase
`;
    const cfg = parseConfig(raw);
    expect(cfg.ci).toBe('github-actions');
    expect(cfg.workflowsDir).toBe('../../.github/workflows');
  });

  it('parses ci object without workflowsDir', () => {
    const raw = `
project:
  type: expo
  bundleId: com.myapp
  packageName: com.myapp
ci:
  provider: gitlab
build:
  preview:
    platform: android
    distribution: firebase
`;
    const cfg = parseConfig(raw);
    expect(cfg.ci).toBe('gitlab');
    expect(cfg.workflowsDir).toBeUndefined();
  });

  it('parses ci object with extraPaths', () => {
    const raw = `
project:
  type: expo
  bundleId: com.myapp
  packageName: com.myapp
ci:
  provider: github-actions
  extraPaths:
    - packages/shared/**
    - package.json
build:
  preview:
    platform: android
    distribution: firebase
`;
    const cfg = parseConfig(raw);
    expect(cfg.extraPaths).toEqual(['packages/shared/**', 'package.json']);
  });

  it('leaves extraPaths undefined when ci object omits it', () => {
    const raw = `
project:
  type: expo
  bundleId: com.myapp
  packageName: com.myapp
ci:
  provider: github-actions
build:
  preview:
    platform: android
    distribution: firebase
`;
    expect(parseConfig(raw).extraPaths).toBeUndefined();
  });

  it('rejects empty extraPaths entries', () => {
    const raw = `
project:
  type: expo
  bundleId: com.myapp
  packageName: com.myapp
ci:
  provider: github-actions
  extraPaths:
    - ''
build:
  preview:
    platform: android
    distribution: firebase
`;
    expect(() => parseConfig(raw)).toThrow(ConfigError);
  });

  it('rejects ci object with invalid provider', () => {
    const raw = `
project:
  type: expo
  bundleId: com.myapp
  packageName: com.myapp
ci:
  provider: circleci
build:
  preview:
    platform: android
    distribution: firebase
`;
    expect(() => parseConfig(raw)).toThrow(ConfigError);
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

  it('parses build profile with ota config', () => {
    const cfg = parseConfig(`
project:
  type: expo
  bundleId: com.myapp
  packageName: com.myapp
ci: github-actions
build:
  production:
    platform: all
    distribution: store
    android:
      buildType: aab
    ota:
      server: https://ota.myapp.com
      channel: production
`);
    expect(cfg.build.production?.ota?.server).toBe('https://ota.myapp.com');
    expect(cfg.build.production?.ota?.channel).toBe('production');
  });

  it('rejects ota config with empty channel', () => {
    expect(() =>
      parseConfig(`
project:
  type: expo
  bundleId: com.myapp
  packageName: com.myapp
ci: github-actions
build:
  production:
    platform: all
    distribution: store
    android:
      buildType: aab
    ota:
      server: https://ota.myapp.com
      channel: ''
`),
    ).toThrow(ConfigError);
  });
});

describe('project.ios signing config', () => {
  it('parses project.ios.developmentTeam and project.ios.match.gitUrl', () => {
    const cfg = parseConfig(fixture('ios-signing.yml'));
    expect(cfg.project.ios?.developmentTeam).toBe('AB12CD34EF');
    expect(cfg.project.ios?.match?.gitUrl).toBe(
      'https://github.com/gvelasco/certificates.git',
    );
  });

  it('leaves project.ios undefined when absent (existing fixtures unaffected)', () => {
    const cfg = parseConfig(fixture('preview-android.yml'));
    expect(cfg.project.ios).toBeUndefined();
  });

  it('defaults storageMode to undefined when omitted, letting the generator apply "git"', () => {
    const cfg = parseConfig(fixture('ios-signing.yml'));
    expect(cfg.project.ios?.match?.storageMode).toBeUndefined();
  });

  it('accepts an explicit storageMode of "git"', () => {
    const raw = `
project:
  type: bare
  bundleId: com.myapp
  packageName: com.myapp
  ios:
    match:
      gitUrl: https://github.com/myorg/certs.git
      storageMode: git
ci: github-actions
build:
  preview:
    platform: ios
    distribution: testflight
`;
    const cfg = parseConfig(raw);
    expect(cfg.project.ios?.match?.storageMode).toBe('git');
  });

  it('rejects an unsupported storageMode', () => {
    const raw = `
project:
  type: bare
  bundleId: com.myapp
  packageName: com.myapp
  ios:
    match:
      gitUrl: https://github.com/myorg/certs.git
      storageMode: s3
ci: github-actions
build:
  preview:
    platform: ios
    distribution: testflight
`;
    expect(() => parseConfig(raw)).toThrow(ConfigError);
  });

  it('rejects a match block without gitUrl', () => {
    const raw = `
project:
  type: bare
  bundleId: com.myapp
  packageName: com.myapp
  ios:
    match: {}
ci: github-actions
build:
  preview:
    platform: ios
    distribution: testflight
`;
    expect(() => parseConfig(raw)).toThrow(ConfigError);
  });

  it('rejects an empty developmentTeam string', () => {
    const raw = `
project:
  type: bare
  bundleId: com.myapp
  packageName: com.myapp
  ios:
    developmentTeam: ''
ci: github-actions
build:
  preview:
    platform: ios
    distribution: testflight
`;
    expect(() => parseConfig(raw)).toThrow(ConfigError);
  });

  it('accepts a valid 10-character developmentTeam', () => {
    const cfg = parseConfig(fixture('ios-signing.yml'));
    expect(cfg.project.ios?.developmentTeam).toBe('AB12CD34EF');
  });

  it('rejects a developmentTeam that is not a 10-char [A-Z0-9] Apple Team ID (xcargs/shell context)', () => {
    const raw = `
project:
  type: bare
  bundleId: com.myapp
  packageName: com.myapp
  ios:
    developmentTeam: "AB12'CD34"
ci: github-actions
build:
  preview:
    platform: ios
    distribution: testflight
`;
    expect(() => parseConfig(raw)).toThrow(ConfigError);
  });

  it('rejects a developmentTeam with the wrong length', () => {
    const raw = `
project:
  type: bare
  bundleId: com.myapp
  packageName: com.myapp
  ios:
    developmentTeam: AB12CD
ci: github-actions
build:
  preview:
    platform: ios
    distribution: testflight
`;
    expect(() => parseConfig(raw)).toThrow(ConfigError);
  });
});

describe('shell/xcargs charset validation (#35)', () => {
  it('rejects a bundleId containing shell/Ruby-breaking characters', () => {
    const raw = `
project:
  type: bare
  bundleId: "com.myapp'; rm -rf /"
  packageName: com.myapp
ci: github-actions
build:
  preview:
    platform: ios
    distribution: testflight
`;
    expect(() => parseConfig(raw)).toThrow(ConfigError);
  });

  it('accepts bundleIds using the standard reverse-DNS charset', () => {
    const cfg = parseConfig(fixture('production-all.yml'));
    expect(cfg.project.bundleId).toBe('com.myapp');
  });

  it('rejects a build profile name containing a space (embedded unquoted in shell/lane contexts)', () => {
    const raw = `
project:
  type: bare
  bundleId: com.myapp
  packageName: com.myapp
ci: github-actions
build:
  "my profile":
    platform: android
    distribution: firebase
`;
    expect(() => parseConfig(raw)).toThrow(ConfigError);
  });

  it('rejects a build profile name containing a quote', () => {
    const raw = `
project:
  type: bare
  bundleId: com.myapp
  packageName: com.myapp
ci: github-actions
build:
  'prod"uction':
    platform: android
    distribution: firebase
`;
    expect(() => parseConfig(raw)).toThrow(ConfigError);
  });

  it('accepts existing simple build profile names unchanged', () => {
    const cfg = parseConfig(fixture('production-all.yml'));
    expect(Object.keys(cfg.build)).toEqual(['preview', 'staging', 'production']);
  });

  it('rejects an ota.server containing shell metacharacters', () => {
    const raw = `
project:
  type: expo
  bundleId: com.myapp
  packageName: com.myapp
ci: github-actions
build:
  production:
    platform: all
    distribution: store
    android:
      buildType: aab
    ota:
      server: "https://ota.myapp.com; rm -rf /"
      channel: production
`;
    expect(() => parseConfig(raw)).toThrow(ConfigError);
  });

  it('rejects a packageName containing a newline (YAML single-quote folding, #40)', () => {
    const raw = `
project:
  type: expo
  bundleId: com.myapp
  packageName: "com.myapp\\nbackdoor"
ci: github-actions
build:
  preview:
    platform: android
    distribution: firebase
`;
    expect(() => parseConfig(raw)).toThrow(ConfigError);
  });

  it('rejects a project.scheme containing a newline', () => {
    const raw = `
project:
  type: expo
  bundleId: com.myapp
  packageName: com.myapp
  scheme: "My\\nScheme"
ci: github-actions
build:
  preview:
    platform: android
    distribution: firebase
`;
    expect(() => parseConfig(raw)).toThrow(ConfigError);
  });

  it('rejects a project.ios.match.gitUrl containing a newline', () => {
    const raw = `
project:
  type: bare
  bundleId: com.myapp
  packageName: com.myapp
  ios:
    match:
      gitUrl: "https://github.com/org/repo.git\\nEvil-Header: x"
ci: github-actions
build:
  preview:
    platform: ios
    distribution: testflight
`;
    expect(() => parseConfig(raw)).toThrow(ConfigError);
  });

  it('rejects a ci.workflowsDir containing a newline', () => {
    const raw = `
project:
  type: expo
  bundleId: com.myapp
  packageName: com.myapp
ci:
  provider: github-actions
  workflowsDir: ".github/workflows\\nevil"
build:
  preview:
    platform: android
    distribution: firebase
`;
    expect(() => parseConfig(raw)).toThrow(ConfigError);
  });

  it('rejects a ci.extraPaths entry containing a newline', () => {
    const raw = `
project:
  type: expo
  bundleId: com.myapp
  packageName: com.myapp
ci:
  provider: github-actions
  extraPaths:
    - "packages/shared/**\\nevil"
build:
  preview:
    platform: android
    distribution: firebase
`;
    expect(() => parseConfig(raw)).toThrow(ConfigError);
  });

  it('rejects an ota.channel containing shell/quote characters', () => {
    const raw = `
project:
  type: expo
  bundleId: com.myapp
  packageName: com.myapp
ci: github-actions
build:
  production:
    platform: all
    distribution: store
    android:
      buildType: aab
    ota:
      server: https://ota.myapp.com
      channel: 'prod"uction'
`;
    expect(() => parseConfig(raw)).toThrow(ConfigError);
  });
});
