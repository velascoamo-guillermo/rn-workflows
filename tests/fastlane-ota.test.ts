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
