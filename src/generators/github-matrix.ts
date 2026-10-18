import { e2ePlatforms, resolveStagingChannel, type Config } from '../config/schema.ts';
import { renderTemplate, yamlScalar } from '../utils/render.ts';
import { platformsFor, secretsFor } from '../secrets.ts';
import { resolveScheme, type GeneratedFile } from './fastlane.ts';
import {
  branchFor,
  e2eCacheKey,
  expoCliFor,
  installCommandFor,
  isSelfHosted,
  legConcurrencyGroup,
  nativeTagPrefix,
  runsOnFor,
  type LegRef,
  type RunsOn,
} from './github-shared.ts';

/** Filename of the single emitted matrix workflow. */
export const MATRIX_WORKFLOW_FILENAME = 'rn-release-matrix.yml';

/** One discovered app in the monorepo. */
export interface MatrixApp {
  /** Posix-relative path from the git root to the app dir; '' for a root-level app. */
  dir: string;
  /** Matrix/filename-safe identifier for the app. */
  slug: string;
  config: Config;
  /** Auto-detected Xcode scheme (Expo `name`), used only when `project.scheme` is unset. */
  scheme?: string;
}

export interface MatrixWorkflowOptions {
  packageManager?: 'yarn' | 'npm' | 'bun';
  /** Directory the workflow file is emitted into. Default: `.github/workflows`. */
  workflowsDir?: string;
  /**
   * Posix-relative path from the git root to the directory the workflow is
   * emitted into. OTA mode watches `<this>/rn-release-matrix.yml` so an edit
   * to the workflow itself selects every OTA leg. Default: `.github/workflows`.
   */
  workflowsPathFromRoot?: string;
}

/**
 * Pre-0.3 release leg (no app has `ota`): kept byte-identical, including the
 * now-meaningless `ota`/`otaUpload` flags, so non-OTA monorepos see no diff.
 */
interface LegacyReleaseLeg {
  app: string;
  dir: string;
  profile: string;
  platform: 'android' | 'ios';
  runsOn: RunsOn;
  selfHosted?: boolean;
  ota: false;
  otaUpload: false;
  otaServer: '';
  otaChannel: '';
}

/**
 * OTA-mode release leg: app × build profile × platform. The plan job selects
 * legs, resolves `hash` for OTA legs and routes each into the `ota` or
 * `native` matrix. Empty strings stand for "not applicable".
 */
interface ReleaseLeg {
  app: string;
  dir: string;
  profile: string;
  platform: 'android' | 'ios';
  runsOn: RunsOn;
  /** Runner is self-hosted: no setup-ruby/setup-xcode, `bundle install` instead. */
  selfHosted: boolean;
  /** Leg is fingerprint-routed (push-triggered); false → native on tag/dispatch only. */
  ota: boolean;
  otaServer: string;
  otaChannel: string;
  stagingChannel: string;
  /** Xcode scheme for the e2e simulator build. */
  scheme: string;
  /** Maestro e2e runs for this leg (RW-8 wires the steps). */
  e2e: boolean;
  flows: string;
  iosDevice: string;
  /** Native release tag prefix; full tag `<tagPrefix>/<hash>`. */
  tagPrefix: string;
  /** Concurrency group shared by this leg's ota and native jobs. */
  group: string;
  /** e2e binary cache key without the trailing hash: key = prefix + hash. */
  e2eCachePrefix: string;
  /** Git-root-relative path prefixes whose change selects this leg on push ('' = any). */
  paths: string[];
  /** Branch whose push selects this leg. */
  branch: string;
  /** `ci.env` as a JSON object string; ota/native jobs export it to `$GITHUB_ENV`. */
  env: string;
}

/** One quality matrix leg: an app with at least one check enabled. */
interface QualityLeg {
  app: string;
  dir: string;
  lint: boolean;
  typecheck: boolean;
  test: boolean;
}

/** GitHub Actions matrix values must never be empty — root apps run in '.'. */
function legDir(dir: string): string {
  return dir === '' ? '.' : dir;
}

/**
 * Git-root-relative prefix for a path glob: everything before the first glob
 * metacharacter (`packages/**` → `packages/`). Over-selects, never misses.
 */
function globPrefix(glob: string): string {
  const cut = glob.search(/[*?[{]/);
  return cut === -1 ? glob : glob.slice(0, cut);
}

function qualityLegs(apps: MatrixApp[]): QualityLeg[] {
  const legs: QualityLeg[] = [];
  for (const app of apps) {
    const checks = app.config.checks ?? {};
    if (checks.lint || checks.typecheck || checks.test) {
      legs.push({
        app: app.slug,
        dir: legDir(app.dir),
        lint: checks.lint ?? false,
        typecheck: checks.typecheck ?? false,
        test: checks.test ?? false,
      });
    }
  }
  return legs;
}

function secretUnion(apps: MatrixApp[]): string[] {
  const set = new Set<string>();
  for (const app of apps) {
    for (const profile of Object.values(app.config.build)) {
      for (const platform of platformsFor(profile.platform)) {
        for (const secret of secretsFor(platform, profile.distribution)) set.add(secret);
      }
    }
  }
  return [...set].sort();
}

/**
 * Generate ONE `strategy.matrix` release workflow covering every app in a
 * monorepo, instead of N near-identical per-app workflows.
 *
 * Without any `ota` profile: tag push + `workflow_dispatch` (optional app
 * filter) → one `release` matrix (pre-0.3 output, byte-identical).
 *
 * With `ota` (OTA mode): also push-triggered on the OTA profiles' branches.
 * The `plan` job selects legs (changed paths on push, all on tag, app filter
 * on dispatch), resolves each OTA leg's per-platform runtimeVersion and
 * routes it: native release tag on origin → `ota` matrix (JS-only update),
 * else → `native` matrix (store lane + tag). Non-OTA legs never run on push.
 */
export function generateMatrixWorkflow(
  apps: MatrixApp[],
  options: MatrixWorkflowOptions = {},
): GeneratedFile {
  if (apps.length === 0) {
    throw new Error('generateMatrixWorkflow requires at least one app');
  }

  const packageManager = options.packageManager ?? 'yarn';
  const workflowsDir = options.workflowsDir ?? '.github/workflows';
  const path = `${workflowsDir}/${MATRIX_WORKFLOW_FILENAME}`;
  const otaMode = apps.some((app) => Object.values(app.config.build).some((p) => p.ota !== undefined));

  const content = otaMode
    ? renderOtaMode(apps, packageManager, options.workflowsPathFromRoot ?? '.github/workflows')
    : renderLegacy(apps, packageManager);
  return { path, content };
}

function renderLegacy(apps: MatrixApp[], packageManager: 'yarn' | 'npm' | 'bun'): string {
  const releaseLegs: LegacyReleaseLeg[] = [];
  let hasIos = false;
  for (const app of apps) {
    for (const [profileName, profile] of Object.entries(app.config.build)) {
      for (const platform of platformsFor(profile.platform)) {
        if (platform === 'ios') hasIos = true;
        const runsOn = runsOnFor(app.config, platform);
        releaseLegs.push({
          app: app.slug,
          dir: legDir(app.dir),
          profile: profileName,
          platform,
          runsOn,
          selfHosted: isSelfHosted(runsOn),
          ota: false,
          otaUpload: false,
          otaServer: '',
          otaChannel: '',
        });
      }
    }
  }

  const secrets = secretUnion(apps);
  const hasSelfHosted = releaseLegs.some((leg) => leg.selfHosted);
  // Keep legs byte-identical to pre-runners output unless a self-hosted leg exists.
  const emittedLegs = hasSelfHosted
    ? releaseLegs
    : releaseLegs.map(({ selfHosted: _selfHosted, ...rest }) => rest);
  const quality = qualityLegs(apps);

  return renderTemplate('github/workflow-matrix.ejs', {
    otaMode: false,
    packageManager,
    qualityLegsJson: JSON.stringify(quality),
    releaseLegsJson: JSON.stringify(emittedLegs),
    hasQuality: quality.length > 0,
    hasSelfHosted,
    secrets,
    matchAuth: hasIos && secrets.includes('MATCH_PASSWORD'),
  });
}

function renderOtaMode(
  apps: MatrixApp[],
  packageManager: 'yarn' | 'npm' | 'bun',
  workflowsPathFromRoot: string,
): string {
  const selfPath = `${workflowsPathFromRoot}/${MATRIX_WORKFLOW_FILENAME}`;
  const releaseLegs: ReleaseLeg[] = [];
  const otaBranches = new Set<string>();
  let usesMatch = false;

  for (const app of apps) {
    const scheme = resolveScheme(app.config, app.scheme);
    const paths = [
      app.dir === '' ? '' : `${app.dir}/`,
      ...(app.config.extraPaths ?? []).filter((p) => !p.startsWith('!')).map(globPrefix),
      selfPath,
    ];
    const env = JSON.stringify(app.config.env ?? {});

    for (const [profileName, profile] of Object.entries(app.config.build)) {
      const branch = branchFor(profileName);
      if (profile.ota) otaBranches.add(branch);
      const e2eFor = profile.ota && profile.e2e ? e2ePlatforms(profile) : [];
      for (const platform of platformsFor(profile.platform)) {
        const ref: LegRef = { appSlug: app.slug, profile: profileName, platform };
        const runsOn = runsOnFor(app.config, platform);
        const stagingChannel = profile.ota ? resolveStagingChannel(profile.ota) : '';
        const e2e = e2eFor.includes(platform);
        if (platform === 'ios' && secretsFor(platform, profile.distribution).includes('MATCH_PASSWORD')) {
          usesMatch = true;
        }
        releaseLegs.push({
          app: app.slug,
          dir: legDir(app.dir),
          profile: profileName,
          platform,
          runsOn,
          selfHosted: isSelfHosted(runsOn),
          ota: profile.ota !== undefined,
          otaServer: profile.ota?.server ?? '',
          otaChannel: profile.ota?.channel ?? '',
          stagingChannel,
          scheme,
          e2e,
          flows: e2e ? (profile.e2e?.maestro.flows ?? '') : '',
          iosDevice: e2e ? (profile.e2e?.maestro.iosDevice ?? '') : '',
          tagPrefix: nativeTagPrefix(ref),
          group: legConcurrencyGroup(ref),
          e2eCachePrefix: e2e ? e2eCacheKey(ref, stagingChannel, '') : '',
          paths,
          branch,
          env,
        });
      }
    }
  }

  const quality = qualityLegs(apps);
  return renderTemplate('github/workflow-matrix.ejs', {
    otaMode: true,
    packageManager,
    qualityLegsJson: JSON.stringify(quality),
    releaseLegsJson: JSON.stringify(releaseLegs),
    hasQuality: quality.length > 0,
    hasIos: releaseLegs.some((leg) => leg.platform === 'ios'),
    hasAndroid: releaseLegs.some((leg) => leg.platform === 'android'),
    hasSelfHosted: releaseLegs.some((leg) => leg.selfHosted),
    branches: [...otaBranches].sort().map(yamlScalar),
    secrets: secretUnion(apps),
    matchAuth: usesMatch,
    maxParallelOne: usesMatch,
    expoCli: expoCliFor(packageManager),
    installCommand: installCommandFor(packageManager),
  });
}
