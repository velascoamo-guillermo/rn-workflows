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
    expect(fastfile.content).toContain('MATCH_READONLY');
    expect(fastfile.content).not.toContain('readonly: true');
  });
});
