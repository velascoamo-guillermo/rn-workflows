import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';

/**
 * #31 north-star acceptance: on a fresh Expo app, `rn-workflows init && generate`
 * should yield working CI/build/deploy config with zero hand-edits to the
 * *generated* files. This suite scaffolds a synthetic fresh Expo app and
 * drives the real CLI end to end for two representative configs (Firebase
 * and TestFlight distribution), then inspects every file `generate` writes.
 *
 * SIGNING BOUNDARY: the actual TestFlight/Firebase *upload* cannot run here
 * (or in this repo's own CI) — it needs real Apple/Firebase credentials that
 * don't exist in a public checkout. This suite proves the CI/Fastlane/docs
 * are correct; the manual last-mile checklist for confirming a real upload
 * is documented in README.md under "Verifying a release".
 *
 * FIDELITY TRADEOFF: the fresh app is hand-scaffolded (a few files rather
 * than `npx create-expo-app`) to keep this suite network-free and fast
 * enough to run in CI on every push (~30s budget). It creates exactly the
 * inputs rn-workflows' generators read: package.json (package-manager
 * detection), app.json (Expo scheme detection — its `expo.name` is
 * deliberately different from package.json's `name`/slug, to catch any
 * code path that wrongly derives the Xcode scheme from the slug instead),
 * a lockfile marker, and a real git repo (generate needs a git root to
 * decide where `.github/workflows` lives).
 */

const REPO_ROOT = resolve(import.meta.dir, '..');
const DIST_CLI = join(REPO_ROOT, 'dist', 'index.js');

const EXPO_APP_NAME = 'Guille Fresh App';
const EXPO_APP_SCHEME = 'GuilleFreshApp'; // sanitizeSchemeName(EXPO_APP_NAME)
const PACKAGE_SLUG = 'wrong-app-slug'; // deliberately != EXPO_APP_NAME, see header comment
const BUNDLE_ID = 'com.example.app';
const TEAM_ID = 'AB12CD34EF';
const MATCH_GIT_URL = 'https://github.com/acme/certificates.git';

let hasRuby = true;
try {
  execFileSync('ruby', ['--version'], { stdio: 'ignore' });
} catch {
  hasRuby = false;
}

function scaffoldFreshApp(dir: string): void {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: PACKAGE_SLUG,
        version: '1.0.0',
        private: true,
        scripts: { test: 'jest', lint: 'eslint .' },
        dependencies: { expo: '~51.0.0' },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(dir, 'app.json'),
    JSON.stringify({ expo: { name: EXPO_APP_NAME, slug: PACKAGE_SLUG, version: '1.0.0' } }, null, 2),
  );
  // Lockfile marker only — detectPackageManagerAt() just checks for its
  // presence, no real bun install needed for generate's own logic.
  writeFileSync(join(dir, 'bun.lock'), '');
  execFileSync('git', ['init', '-q'], { cwd: dir });
}

function runCli(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('node', [DIST_CLI, ...args], {
    cwd,
    input: '',
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

function listWorkflowFiles(appDir: string): string[] {
  const dir = join(appDir, '.github', 'workflows');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yml'))
    .map((f) => join(dir, f));
}

/** Every `${{ secrets.NAME }}` referenced across the given workflow files. */
function secretsReferencedIn(workflowPaths: string[]): string[] {
  const names = new Set<string>();
  for (const path of workflowPaths) {
    const content = readFileSync(path, 'utf8');
    for (const m of content.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g)) {
      names.add(m[1]!);
    }
  }
  return [...names].sort();
}

interface Step {
  name?: string;
  run?: string;
}
interface WorkflowYaml {
  jobs: Record<string, { steps: Step[] }>;
}

interface Scenario {
  label: string;
  appDir: string;
  bundleId: string;
  hasMatch: boolean;
  hasDevelopmentTeam: boolean;
}

function setUpScenario(dirPrefix: string, initArgs: string[], amendIos: boolean): Scenario {
  const appDir = mkdtempSync(join(tmpdir(), dirPrefix));
  scaffoldFreshApp(appDir);

  const init = runCli(['init', '--yes', '--cwd', appDir, '--bundle-id', BUNDLE_ID, ...initArgs], appDir);
  if (init.status !== 0) {
    throw new Error(`init failed (status ${init.status}):\n${init.stderr}\n${init.stdout}`);
  }

  const configPath = join(appDir, 'rn-workflows.yml');
  if (amendIos) {
    // developmentTeam/match require a real Apple Developer Team ID and a
    // real certificates repo — init deliberately never prompts for these
    // (see src/commands/init.ts), so a project that needs signing sets them
    // by hand once. That is the one config field this suite cannot get from
    // `init` alone; everything downstream (Fastfile/Appfile/Matchfile) is
    // still generated, asserted below.
    const parsed = yaml.load(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    const project = parsed.project as Record<string, unknown>;
    project.ios = { developmentTeam: TEAM_ID, match: { gitUrl: MATCH_GIT_URL } };
    writeFileSync(configPath, yaml.dump(parsed, { noRefs: true, lineWidth: 120 }));
  }

  return {
    label: dirPrefix,
    appDir,
    bundleId: BUNDLE_ID,
    hasMatch: amendIos,
    hasDevelopmentTeam: amendIos,
  };
}

describe('e2e: fresh Expo app -> init -> generate (#31 acceptance)', () => {
  const scenarios: Scenario[] = [
    setUpScenario(
      'rnwf-e2e-firebase-',
      ['--distribution', 'firebase', '--profiles', 'preview,staging,production'],
      false,
    ),
    setUpScenario(
      'rnwf-e2e-testflight-',
      ['--distribution', 'testflight', '--profiles', 'staging,production'],
      true,
    ),
  ];

  afterAll(() => {
    for (const scenario of scenarios) rmSync(scenario.appDir, { recursive: true, force: true });
  });

  for (const scenario of scenarios) {
    describe(scenario.label, () => {
      const generate = runCli(['generate', '--cwd', scenario.appDir], scenario.appDir);

      test('generate exits cleanly against the shipped dist/index.js', () => {
        expect(generate.status).toBe(0);
      });

      const workflowPaths = listWorkflowFiles(scenario.appDir);

      test('at least one CI workflow is emitted and YAML-parses with a quality job', () => {
        expect(workflowPaths.length).toBeGreaterThan(0);
        const parsed = yaml.load(readFileSync(workflowPaths[0]!, 'utf8')) as WorkflowYaml;
        const steps = parsed.jobs.quality?.steps ?? [];
        const names = steps.map((s) => s.name);
        expect(names).toContain('Lint');
        expect(names).toContain('Type check');
        expect(names).toContain('Test');
      });

      const fastfilePath = join(scenario.appDir, 'fastlane', 'Fastfile');
      const fastfile = readIfExists(fastfilePath);

      test('Fastfile is emitted and is syntactically valid Ruby', () => {
        expect(fastfile).toBeDefined();
        if (!hasRuby) return; // CI runners have ruby; only skip locally if absent.
        const check = spawnSync('ruby', ['-c', fastfilePath], { encoding: 'utf8' });
        expect(check.status).toBe(0);
      });

      test('Xcode scheme/workspace is detected from app.json, not the package.json slug', () => {
        expect(fastfile).toContain(`ios/${EXPO_APP_SCHEME}.xcworkspace`);
        expect(fastfile).not.toContain(PACKAGE_SLUG);
      });

      test('prebuild lane exists with the unbundled-env guard', () => {
        expect(fastfile).toContain('private_lane :prebuild');
        expect(fastfile).toContain('Bundler.with_unbundled_env');
      });

      test('never references the retired APP_STORE_CONNECT_API_KEY_PATH', () => {
        const setupMd = readIfExists(join(scenario.appDir, 'SETUP.md'));
        const matchfile = readIfExists(join(scenario.appDir, 'fastlane', 'Matchfile'));
        const combined = [fastfile, setupMd, matchfile, ...workflowPaths.map((p) => readFileSync(p, 'utf8'))]
          .filter((s): s is string => Boolean(s))
          .join('\n');
        expect(combined).not.toContain('APP_STORE_CONNECT_API_KEY_PATH');
      });

      test('SETUP.md documents every secret referenced by the emitted workflow(s)', () => {
        const setupMd = readIfExists(join(scenario.appDir, 'SETUP.md'));
        const referenced = secretsReferencedIn(workflowPaths);
        expect(referenced.length).toBeGreaterThan(0);
        expect(setupMd).toBeDefined();
        for (const name of referenced) {
          expect(setupMd).toContain(`## ${name}`);
          // Every secret gets a ready-to-run set command (optional ones are
          // additionally marked "(optional)" in the same heading line).
          expect(setupMd).toContain(`gh secret set ${name}`);
        }
      });

      const matchfilePath = join(scenario.appDir, 'fastlane', 'Matchfile');

      if (scenario.hasMatch) {
        test('Matchfile is emitted when project.ios.match is set', () => {
          expect(existsSync(matchfilePath)).toBe(true);
          expect(readFileSync(matchfilePath, 'utf8')).toContain(MATCH_GIT_URL);
        });

        test('Appfile/xcargs/export_options carry the configured developmentTeam', () => {
          const appfile = readFileSync(join(scenario.appDir, 'fastlane', 'Appfile'), 'utf8');
          expect(appfile).toContain(`team_id("${TEAM_ID}")`);
          expect(fastfile).toContain(`DEVELOPMENT_TEAM=${TEAM_ID}`);
          expect(fastfile).toContain(`teamID: "${TEAM_ID}"`);
        });

        test('production lane matches AppStore with the Apple Distribution identity', () => {
          expect(fastfile).toContain(`match AppStore ${scenario.bundleId}`);
          expect(fastfile).toContain('Apple Distribution');
          expect(fastfile).toContain('upload_to_testflight');
        });
      } else {
        test('Matchfile is not emitted when project.ios.match is unset', () => {
          expect(existsSync(matchfilePath)).toBe(false);
        });

        test('firebase_app_distribution lanes are emitted for android and iOS', () => {
          const occurrences = fastfile?.split('firebase_app_distribution(').length ?? 1;
          expect(occurrences - 1).toBeGreaterThanOrEqual(2);
        });
      }
    });
  }
});
