import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig } from '../src/config/parser.ts';
import { generateGithubActions } from '../src/generators/github-actions.ts';

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8');

describe('github-actions generator', () => {
  it('emits one workflow per profile', () => {
    const cfg = parseConfig(fixture('production-all.yml'));
    const files = generateGithubActions(cfg);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual([
      '.github/workflows/rn-preview.yml',
      '.github/workflows/rn-production.yml',
      '.github/workflows/rn-staging.yml',
    ]);
  });

  it('includes expected firebase secrets', () => {
    const cfg = parseConfig(fixture('preview-android.yml'));
    const [file] = generateGithubActions(cfg);
    expect(file!.content).toContain('FIREBASE_APP_ID_ANDROID');
    expect(file!.content).toContain('FIREBASE_SERVICE_ACCOUNT_JSON');
    expect(file!.content).toContain('${{ secrets.FIREBASE_APP_ID_ANDROID }}');
  });

  it('uses macos runner for ios jobs', () => {
    const cfg = parseConfig(fixture('production-all.yml'));
    const production = generateGithubActions(cfg).find(
      (f) => f.path === '.github/workflows/rn-production.yml',
    )!;
    expect(production.content).toContain('macos-latest');
    expect(production.content).toContain('ubuntu-latest');
  });

  it('sets default branch by profile name', () => {
    const cfg = parseConfig(fixture('production-all.yml'));
    const preview = generateGithubActions(cfg).find(
      (f) => f.path === '.github/workflows/rn-preview.yml',
    )!;
    expect(preview.content).toContain('branches: [develop]');
    const production = generateGithubActions(cfg).find(
      (f) => f.path === '.github/workflows/rn-production.yml',
    )!;
    expect(production.content).toContain('branches: [main]');
  });
});
