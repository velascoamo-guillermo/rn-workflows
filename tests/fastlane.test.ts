import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig } from '../src/config/parser.ts';
import { generateFastlane } from '../src/generators/fastlane.ts';

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8');

describe('fastlane generator', () => {
  it('emits Fastfile, Appfile, Gemfile, Pluginfile', () => {
    const cfg = parseConfig(fixture('production-all.yml'));
    const files = generateFastlane(cfg);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual([
      'Gemfile',
      'fastlane/Appfile',
      'fastlane/Fastfile',
      'fastlane/Pluginfile',
    ]);
  });

  it('Fastfile contains android and ios platforms', () => {
    const cfg = parseConfig(fixture('production-all.yml'));
    const files = generateFastlane(cfg);
    const fastfile = files.find((f) => f.path === 'fastlane/Fastfile')!;
    expect(fastfile.content).toContain('platform :android');
    expect(fastfile.content).toContain('platform :ios');
    expect(fastfile.content).toContain('lane :preview do');
    expect(fastfile.content).toContain('lane :production do');
  });

  it('uses bundle task when buildType is aab', () => {
    const cfg = parseConfig(fixture('production-all.yml'));
    const fastfile = generateFastlane(cfg).find((f) => f.path === 'fastlane/Fastfile')!;
    expect(fastfile.content).toContain('task: "bundle"');
  });

  it('uses assemble task when buildType is apk', () => {
    const cfg = parseConfig(fixture('preview-android.yml'));
    const fastfile = generateFastlane(cfg).find((f) => f.path === 'fastlane/Fastfile')!;
    expect(fastfile.content).toContain('task: "assemble"');
  });

  it('Appfile contains bundleId and packageName', () => {
    const cfg = parseConfig(fixture('preview-android.yml'));
    const appfile = generateFastlane(cfg).find((f) => f.path === 'fastlane/Appfile')!;
    expect(appfile.content).toContain('com.myapp');
  });

  it('Pluginfile lists firebase plugin when used', () => {
    const cfg = parseConfig(fixture('preview-android.yml'));
    const pluginfile = generateFastlane(cfg).find((f) => f.path === 'fastlane/Pluginfile')!;
    expect(pluginfile.content).toContain('firebase_app_distribution');
  });

  it('Fastfile match call uses MATCH_READONLY env var instead of hardcoded true', () => {
    const cfg = parseConfig(fixture('production-all.yml'));
    const fastfile = generateFastlane(cfg).find((f) => f.path === 'fastlane/Fastfile')!;
    expect(fastfile.content).toContain(
      'readonly: ENV.fetch("MATCH_READONLY", "true") == "true"',
    );
  });

  it('uses bun install in workflow when packageManager is bun', () => {
    const cfg = parseConfig(fixture('preview-android.yml'));
    const files = generateFastlane(cfg, { packageManager: 'bun' });
    const fastfile = files.find((f) => f.path === 'fastlane/Fastfile')!;
    expect(fastfile.content).not.toContain('bun install');
  });

  it('does not include npm ci in Fastfile when packageManager is npm', () => {
    const cfg = parseConfig(fixture('preview-android.yml'));
    const files = generateFastlane(cfg, { packageManager: 'npm' });
    const fastfile = files.find((f) => f.path === 'fastlane/Fastfile')!;
    expect(fastfile.content).not.toContain('npm ci');
  });
});

const fastfileFor = (name: string, options?: Parameters<typeof generateFastlane>[1]) =>
  generateFastlane(parseConfig(fixture(name)), options).find(
    (f) => f.path === 'fastlane/Fastfile',
  )!.content;

describe('xcode scheme resolution', () => {
  it('uses the explicit project.scheme instead of the bundle id slug', () => {
    const content = fastfileFor('expo-pawlog-scheme.yml');
    expect(content).toContain('workspace: "ios/Pawlog.xcworkspace"');
    expect(content).toContain('scheme: "Pawlog"');
    expect(content).not.toContain('ios/pawlog.xcworkspace');
  });

  it('uses the detected expo name when project.scheme is unset', () => {
    const content = fastfileFor('expo-pawlog.yml', { scheme: 'Pawlog' });
    expect(content).toContain('workspace: "ios/Pawlog.xcworkspace"');
    expect(content).toContain('scheme: "Pawlog"');
  });

  it('prefers the explicit project.scheme over a detected one', () => {
    const content = fastfileFor('expo-pawlog-scheme.yml', { scheme: 'SomethingElse' });
    expect(content).toContain('scheme: "Pawlog"');
    expect(content).not.toContain('SomethingElse');
  });

  it('falls back to the last bundle id segment when nothing else is known', () => {
    const content = fastfileFor('expo-pawlog.yml');
    expect(content).toContain('workspace: "ios/pawlog.xcworkspace"');
    expect(content).toContain('scheme: "pawlog"');
  });
});

describe('match profile names', () => {
  it('maps exportMethod app-store to "match AppStore <bundleId>"', () => {
    const content = fastfileFor('expo-pawlog-scheme.yml');
    expect(content).toContain('match(type: "appstore"');
    expect(content).toContain("PROVISIONING_PROFILE_SPECIFIER='match AppStore com.gvelasco.pawlog'");
    expect(content).toContain(
      '"com.gvelasco.pawlog" => "match AppStore com.gvelasco.pawlog"',
    );
    expect(content).not.toContain('match Development');
  });

  it('maps exportMethod ad-hoc to "match AdHoc <bundleId>"', () => {
    const content = fastfileFor('gitlab-staging.yml');
    expect(content).toContain('match(type: "adhoc"');
    expect(content).toContain("PROVISIONING_PROFILE_SPECIFIER='match AdHoc com.myapp'");
    expect(content).toContain('"com.myapp" => "match AdHoc com.myapp"');
    expect(content).not.toContain('match Development com.myapp');
  });

  it('maps exportMethod development to "match Development <bundleId>"', () => {
    const content = fastfileFor('ios-development.yml');
    expect(content).toContain('match(type: "development"');
    expect(content).toContain(
      "PROVISIONING_PROFILE_SPECIFIER='match Development com.gvelasco.pawlog'",
    );
    expect(content).toContain(
      '"com.gvelasco.pawlog" => "match Development com.gvelasco.pawlog"',
    );
  });

  it('never emits the legacy iPhone Distribution identity', () => {
    for (const f of ['expo-pawlog-scheme.yml', 'gitlab-staging.yml', 'ios-development.yml']) {
      expect(fastfileFor(f)).not.toContain('iPhone Distribution');
    }
  });

  it('signs distribution builds with Apple Distribution', () => {
    expect(fastfileFor('expo-pawlog-scheme.yml')).toContain(
      "CODE_SIGN_IDENTITY='Apple Distribution'",
    );
    expect(fastfileFor('gitlab-staging.yml')).toContain(
      "CODE_SIGN_IDENTITY='Apple Distribution'",
    );
  });

  it('signs development builds with Apple Development', () => {
    expect(fastfileFor('ios-development.yml')).toContain(
      "CODE_SIGN_IDENTITY='Apple Development'",
    );
  });
});

describe('default_platform', () => {
  it('is :android when android profiles exist', () => {
    expect(fastfileFor('production-all.yml')).toContain('default_platform(:android)');
  });

  it('is :ios when only ios profiles are configured', () => {
    const content = fastfileFor('ios-development.yml');
    expect(content).toContain('default_platform(:ios)');
    expect(content).not.toContain('default_platform(:android)');
  });
});

describe('Fastfile snapshot', () => {
  it('matches the committed Fastfile for an expo production config', () => {
    expect(fastfileFor('expo-pawlog.yml', { scheme: 'Pawlog' })).toMatchSnapshot();
  });
});

describe('Matchfile', () => {
  it('is not emitted when project.ios.match is absent', () => {
    const cfg = parseConfig(fixture('production-all.yml'));
    const files = generateFastlane(cfg);
    expect(files.find((f) => f.path === 'fastlane/Matchfile')).toBeUndefined();
  });

  it('is emitted with git_url, storage_mode and app_identifier when project.ios.match is present', () => {
    const cfg = parseConfig(fixture('ios-signing.yml'));
    const files = generateFastlane(cfg);
    const matchfile = files.find((f) => f.path === 'fastlane/Matchfile');
    expect(matchfile).toBeDefined();
    expect(matchfile!.content).toContain(
      'git_url("https://github.com/gvelasco/certificates.git")',
    );
    expect(matchfile!.content).toContain('storage_mode("git")');
    expect(matchfile!.content).toContain('app_identifier("com.gvelasco.pawlog")');
  });
});

describe('developmentTeam signing', () => {
  it('renders team_id into Appfile when project.ios.developmentTeam is set', () => {
    const cfg = parseConfig(fixture('ios-signing.yml'));
    const appfile = generateFastlane(cfg).find((f) => f.path === 'fastlane/Appfile')!;
    expect(appfile.content).toContain('team_id("AB12CD34EF")');
  });

  it('falls back to the ENV-based team_id in Appfile when developmentTeam is unset', () => {
    const cfg = parseConfig(fixture('production-all.yml'));
    const appfile = generateFastlane(cfg).find((f) => f.path === 'fastlane/Appfile')!;
    expect(appfile.content).toContain('team_id(ENV["APPLE_TEAM_ID"]) if ENV["APPLE_TEAM_ID"]');
    expect(appfile.content).not.toContain('DEVELOPMENT_TEAM');
  });

  it('adds DEVELOPMENT_TEAM to the manual-signing xcargs in iOS lanes when set', () => {
    const cfg = parseConfig(fixture('ios-signing.yml'));
    const fastfile = generateFastlane(cfg).find((f) => f.path === 'fastlane/Fastfile')!;
    expect(fastfile.content).toContain(
      "xcargs: \"CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=AB12CD34EF PROVISIONING_PROFILE_SPECIFIER='match AppStore com.gvelasco.pawlog' CODE_SIGN_IDENTITY='Apple Distribution'\",",
    );
  });

  it('omits DEVELOPMENT_TEAM from xcargs when developmentTeam is unset (existing behavior)', () => {
    const content = fastfileFor('expo-pawlog-scheme.yml');
    expect(content).not.toContain('DEVELOPMENT_TEAM');
    expect(content).toContain(
      "xcargs: \"CODE_SIGN_STYLE=Manual PROVISIONING_PROFILE_SPECIFIER='match AppStore com.gvelasco.pawlog' CODE_SIGN_IDENTITY='Apple Distribution'\",",
    );
  });

  it('adds teamID to export_options when developmentTeam is set', () => {
    const content = fastfileFor('ios-signing.yml');
    expect(content).toContain('teamID: "AB12CD34EF"');
  });

  it('omits teamID from export_options when developmentTeam is unset', () => {
    const content = fastfileFor('expo-pawlog-scheme.yml');
    expect(content).not.toContain('teamID:');
  });

  it('renders a literal team_id in Appfile when developmentTeam is set (explicit wins)', () => {
    const cfg = parseConfig(fixture('ios-signing.yml'));
    const appfile = generateFastlane(cfg).find((f) => f.path === 'fastlane/Appfile')!;
    expect(appfile.content).toContain('team_id("AB12CD34EF")');
    expect(appfile.content).not.toContain('ENV["APPLE_TEAM_ID"]');
  });

  it('keeps the ENV-based team_id fallback in Appfile when developmentTeam is unset', () => {
    const cfg = parseConfig(fixture('production-all.yml'));
    const appfile = generateFastlane(cfg).find((f) => f.path === 'fastlane/Appfile')!;
    expect(appfile.content).toContain('team_id(ENV["APPLE_TEAM_ID"]) if ENV["APPLE_TEAM_ID"]');
  });
});
