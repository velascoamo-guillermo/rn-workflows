import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectExpoScheme, sanitizeSchemeName } from '../src/utils/expo.ts';

const dirs: string[] = [];

function scratch(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rn-workflows-test-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('sanitizeSchemeName', () => {
  it('keeps an already-valid name intact', () => {
    expect(sanitizeSchemeName('Pawlog')).toBe('Pawlog');
  });

  it('strips whitespace and punctuation like expo prebuild does', () => {
    expect(sanitizeSchemeName('My App')).toBe('MyApp');
    expect(sanitizeSchemeName("Guille's App!")).toBe('GuillesApp');
  });
});

describe('detectExpoScheme', () => {
  it('reads expo.name from app.json, not the slug', () => {
    const dir = scratch({
      'app.json': JSON.stringify({ expo: { name: 'Pawlog', slug: 'pawlog' } }),
    });
    expect(detectExpoScheme(dir)).toBe('Pawlog');
  });

  it('sanitizes the detected name', () => {
    const dir = scratch({ 'app.json': JSON.stringify({ expo: { name: 'My App' } }) });
    expect(detectExpoScheme(dir)).toBe('MyApp');
  });

  it('falls back to a top-level name field', () => {
    const dir = scratch({ 'app.json': JSON.stringify({ name: 'BareApp' }) });
    expect(detectExpoScheme(dir)).toBe('BareApp');
  });

  it('reads app.config.json when app.json is absent', () => {
    const dir = scratch({
      'app.config.json': JSON.stringify({ expo: { name: 'Pawlog' } }),
    });
    expect(detectExpoScheme(dir)).toBe('Pawlog');
  });

  it('returns undefined when there is no static config', () => {
    expect(detectExpoScheme(scratch({}))).toBeUndefined();
  });

  it('returns undefined on malformed JSON instead of throwing', () => {
    const dir = scratch({ 'app.json': '{ not json' });
    expect(detectExpoScheme(dir)).toBeUndefined();
  });
});
