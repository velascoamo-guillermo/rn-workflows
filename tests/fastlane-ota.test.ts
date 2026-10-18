import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '../src/config/parser.ts';
import { generateFastlane } from '../src/generators/fastlane.ts';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8');

const fastfileFor = (name: string): string =>
  generateFastlane(parseConfig(fixture(name)), { scheme: 'OtaAll' }).find(
    (f) => f.path === 'fastlane/Fastfile',
  )!.content;

/** Body of the first `platform :<p>` block that defines `lane :<lane>`. */
function laneBody(content: string, platform: 'ios' | 'android', lane: string): string {
  const re = new RegExp(`platform :${platform} do\\n[\\s\\S]*?lane :${lane} do\\n([\\s\\S]*?)\\n  end\\nend`);
  const m = re.exec(content);
  if (!m) throw new Error(`lane ${platform}/${lane} not found`);
  return m[1]!;
}

describe('I1: ota native path stops at the testing track', () => {
  it('ota + testflight+store iOS lane uploads to TestFlight only', () => {
    const ios = laneBody(fastfileFor('ota-e2e-all.yml'), 'ios', 'production');
    expect(ios).toContain('upload_to_testflight(');
    expect(ios).not.toContain('upload_to_app_store');
  });

  it('non-ota store profile still uploads to the App Store', () => {
    const ios = laneBody(fastfileFor('production-all.yml'), 'ios', 'production');
    expect(ios).toContain('upload_to_app_store(');
  });
});

describe('I1: ota + store-only iOS distribution', () => {
  it('routes the store target to TestFlight instead of the App Store', () => {
    const yml = fixture('ota-e2e-all.yml').replace('distribution: testflight+store', 'distribution: store');
    const content = generateFastlane(parseConfig(yml), { scheme: 'OtaAll' }).find(
      (f) => f.path === 'fastlane/Fastfile',
    )!.content;
    const ios = laneBody(content, 'ios', 'production');
    expect(ios).toContain('upload_to_testflight(');
    expect(ios).not.toContain('upload_to_app_store');
  });
});

describe('I2: build numbers when ota is set', () => {
  it('iOS lane sets the build number from the latest TestFlight build + 1 before build_app', () => {
    const ios = laneBody(fastfileFor('ota-e2e-all.yml'), 'ios', 'production');
    const inc = ios.indexOf('increment_build_number(');
    expect(inc).toBeGreaterThan(-1);
    expect(inc).toBeLessThan(ios.indexOf('build_app('));
    expect(ios).toContain('xcodeproj: "ios/OtaAll.xcodeproj"');
    expect(ios).toContain(
      'latest_testflight_build_number(app_identifier: "com.example.otaall", api_key: lane_context[SharedValues::APP_STORE_CONNECT_API_KEY]) + 1',
    );
  });

  it('Android lane computes the next versionCode from Play and injects it into gradle', () => {
    const android = laneBody(fastfileFor('ota-e2e-all.yml'), 'android', 'production');
    expect(android).toContain('google_play_track_version_codes(');
    expect(android).toContain('track: "internal"');
    expect(android).toContain('json_key_data: ENV["PLAY_STORE_JSON_KEY"]');
    expect(android).toContain('package_name: "com.example.otaall"');
    expect(android).toContain('"android.injected.version.code" => next_version_code');
    expect(android.indexOf('next_version_code =')).toBeLessThan(android.indexOf('gradle('));
  });

  it('escapes #{} in bundleId/packageName/scheme', () => {
    const cfg = parseConfig(fixture('ota-e2e-all.yml'));
    const hostile = {
      ...cfg,
      project: { ...cfg.project, bundleId: 'com.x#{ENV["A"]}', packageName: 'com.y#{ENV["B"]}' },
    };
    const content = generateFastlane(hostile, { scheme: 'S#{ENV["C"]}' }).find(
      (f) => f.path === 'fastlane/Fastfile',
    )!.content;
    expect(content).not.toContain('#{ENV["A"]}');
    expect(content).not.toContain('#{ENV["B"]}');
    expect(content).not.toContain('#{ENV["C"]}');
  });

  it('non-ota Fastfile has no build-number handling', () => {
    const content = fastfileFor('production-all.yml');
    expect(content).not.toContain('increment_build_number');
    expect(content).not.toContain('google_play_track_version_codes');
    expect(content).not.toContain('android.injected.version.code');
  });

  it('ota Fastfile is valid ruby (ruby -c)', () => {
    try {
      execFileSync('ruby', ['-v'], { stdio: 'ignore' });
    } catch {
      console.warn('ruby not on PATH — skipping ruby -c syntax check');
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'rnw-ota-rubyc-'));
    try {
      const file = join(dir, 'Fastfile');
      writeFileSync(file, fastfileFor('ota-e2e-all.yml'));
      expect(() => execFileSync('ruby', ['-c', file], { stdio: 'pipe' })).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
