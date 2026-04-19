import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig } from '../src/config/parser.ts';
import { generateGitlab } from '../src/generators/gitlab.ts';

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8');

describe('gitlab generator', () => {
  it('emits single .gitlab-ci.yml', () => {
    const cfg = parseConfig(fixture('gitlab-staging.yml'));
    const files = generateGitlab(cfg);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe('.gitlab-ci.yml');
  });

  it('includes android + ios jobs for platform=all', () => {
    const cfg = parseConfig(fixture('gitlab-staging.yml'));
    const [file] = generateGitlab(cfg);
    expect(file!.content).toContain('build:staging:android:');
    expect(file!.content).toContain('build:staging:ios:');
  });

  it('references CI variables for secrets', () => {
    const cfg = parseConfig(fixture('gitlab-staging.yml'));
    const [file] = generateGitlab(cfg);
    expect(file!.content).toContain('FIREBASE_APP_ID_ANDROID: $FIREBASE_APP_ID_ANDROID');
  });
});
