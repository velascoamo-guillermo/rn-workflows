import { describe, expect, test } from 'bun:test';
import yaml from 'js-yaml';
import { generateGithubActions } from '../src/generators/github-actions';
import type { Config } from '../src/config/schema';

interface WorkflowYaml {
  name: string;
  on: { push: { paths?: string[] } };
  jobs: Record<string, { name?: string; defaults?: { run?: { 'working-directory'?: string } } }>;
}

describe('github-actions EJS escaping of hostile-but-legal config values (#35)', () => {
  test('extraPaths with & and quotes render raw (no HTML entities) and round-trip through YAML unchanged', () => {
    const config: Config = {
      project: { type: 'bare', bundleId: 'com.test.app', packageName: 'com.test.app' },
      ci: 'github-actions',
      extraPaths: [`packages/shared's/**`, `path & "extra"/**`],
      build: {
        preview: { platform: 'android', distribution: 'firebase' },
      },
    };
    const { content } = generateGithubActions(config, { appDir: 'apps/mobile' })[0]!;

    expect(content).not.toContain('&amp;');
    expect(content).not.toContain('&#39;');
    expect(content).not.toContain('&quot;');

    const parsed = yaml.load(content) as WorkflowYaml;
    expect(parsed.on.push.paths).toContain(`packages/shared's/**`);
    expect(parsed.on.push.paths).toContain(`path & "extra"/**`);
  });

  test('an appDir containing a single quote round-trips through the on.push.paths filter unchanged', () => {
    const config: Config = {
      project: { type: 'bare', bundleId: 'com.test.app', packageName: 'com.test.app' },
      ci: 'github-actions',
      build: {
        preview: { platform: 'android', distribution: 'firebase' },
      },
    };
    const { content } = generateGithubActions(config, {
      appDir: `apps/o'brien`,
      appSlug: 'obrien',
    })[0]!;

    expect(content).not.toContain('&#39;');

    const parsed = yaml.load(content) as WorkflowYaml;
    expect(parsed.on.push.paths).toContain(`apps/o'brien/**`);
  });

  test('a workflowName/job.name built from a hostile build profile name is quoted, not HTML-escaped', () => {
    const config: Config = {
      project: { type: 'bare', bundleId: 'com.test.app', packageName: 'com.test.app' },
      ci: 'github-actions',
      // Schema forbids this at parse time (see config.test.ts); the
      // generator/template must still not corrupt it via HTML-escaping if
      // ever called directly with an already-validated-elsewhere Config.
      build: {
        preview: { platform: 'android', distribution: 'firebase' },
      },
    };
    const { content } = generateGithubActions(config)[0]!;
    const parsed = yaml.load(content) as WorkflowYaml;
    expect(parsed.name).toBe('rn-workflows • preview');
    expect(parsed.jobs['build-android']?.name).toBe('Build preview (android)');
  });

  test('OTA workflow (workflow-smart.ejs): extraPaths with hostile characters round-trip unchanged', () => {
    const config: Config = {
      project: { type: 'expo', bundleId: 'com.test.app', packageName: 'com.test.app' },
      ci: 'github-actions',
      extraPaths: [`shared/"quoted"/**`],
      build: {
        production: {
          platform: 'all',
          distribution: 'store',
          android: { buildType: 'aab' },
          ota: { server: 'https://ota.example.com', channel: 'production' },
        },
      },
    };
    const { content } = generateGithubActions(config, { appDir: 'apps/mobile' })[0]!;
    expect(content).not.toContain('&quot;');
    const parsed = yaml.load(content) as WorkflowYaml;
    expect(parsed.on.push.paths).toContain(`shared/"quoted"/**`);
  });

  test('ota.server is interpolated raw into the curl command, not HTML-escaped (#40)', () => {
    // Schema forbids `&`-adjacent-to-HTML-unsafe-chars combos and `<>` at
    // parse time (see config.test.ts); the template itself is a second line
    // of defense against `<%=`'s HTML-escaping corrupting an
    // already-validated-elsewhere Config's ota.server in the shell command.
    const config: Config = {
      project: { type: 'expo', bundleId: 'com.test.app', packageName: 'com.test.app' },
      ci: 'github-actions',
      build: {
        production: {
          platform: 'all',
          distribution: 'store',
          android: { buildType: 'aab' },
          ota: { server: 'https://ota.example.com/a&b', channel: 'production' },
        },
      },
    };
    const { content } = generateGithubActions(config, { appDir: 'apps/mobile' })[0]!;
    expect(content).not.toContain('&amp;');
    expect(content).toContain('curl -X POST https://ota.example.com/a&b/api/upload');
  });

  test('appDir is interpolated raw into `mkdir -p`, not HTML-escaped (#40)', () => {
    const config: Config = {
      project: { type: 'expo', bundleId: 'com.test.app', packageName: 'com.test.app' },
      ci: 'github-actions',
      build: {
        production: {
          platform: 'all',
          distribution: 'store',
          android: { buildType: 'aab' },
          ota: { server: 'https://ota.example.com', channel: 'production' },
        },
      },
    };
    // appDir is internally computed (git-root-relative path), not raw user
    // config — but the fix is about the render path, not schema.
    const { content } = generateGithubActions(config, { appDir: `apps/o'brien&co` })[0]!;
    expect(content).not.toContain('&amp;');
    expect(content).toContain(`mkdir -p apps/o'brien&co/.rn-fingerprint`);
  });
});
