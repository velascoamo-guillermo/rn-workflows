import type { Config } from '../config/schema.ts';
import { renderTemplate } from '../utils/render.ts';
import { platformsFor, secretsFor } from '../secrets.ts';
import type { GeneratedFile } from './fastlane.ts';

/** Filename of the single emitted matrix workflow. */
export const MATRIX_WORKFLOW_FILENAME = 'rn-release-matrix.yml';

/** One discovered app in the monorepo. */
export interface MatrixApp {
  /** Posix-relative path from the git root to the app dir; '' for a root-level app. */
  dir: string;
  /** Matrix/filename-safe identifier for the app. */
  slug: string;
  config: Config;
}

export interface MatrixWorkflowOptions {
  packageManager?: 'yarn' | 'npm' | 'bun';
  /** Directory the workflow file is emitted into. Default: `.github/workflows`. */
  workflowsDir?: string;
}

/** One release matrix leg: app × build profile × platform. */
interface ReleaseLeg {
  app: string;
  dir: string;
  profile: string;
  platform: 'android' | 'ios';
  runsOn: string;
  /** Leg participates in OTA fingerprint/skip logic. */
  ota: boolean;
  /**
   * Leg performs the OTA export + upload. Exactly one leg per app × profile:
   * `expo export --platform all` produces a universal bundle, so uploading it
   * from every platform leg would push the same bundle twice to one channel.
   * The cheapest leg (android/ubuntu) is chosen when the profile targets both.
   */
  otaUpload: boolean;
  otaServer: string;
  otaChannel: string;
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
 * Generate ONE `strategy.matrix` release workflow covering every app in a
 * monorepo, instead of N near-identical per-app workflows.
 *
 * Deliberately triggered by tag push + `workflow_dispatch` (with an optional
 * app filter) and NOT by `on.push.paths`: a path-triggered matrix over all
 * apps would rebuild every app on any single app's change.
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

  const qualityLegs: QualityLeg[] = [];
  const releaseLegs: ReleaseLeg[] = [];
  const secretUnion = new Set<string>();
  let hasIos = false;

  for (const app of apps) {
    const checks = app.config.checks ?? {};
    if (checks.lint || checks.typecheck || checks.test) {
      qualityLegs.push({
        app: app.slug,
        dir: legDir(app.dir),
        lint: checks.lint ?? false,
        typecheck: checks.typecheck ?? false,
        test: checks.test ?? false,
      });
    }

    for (const [profileName, profile] of Object.entries(app.config.build)) {
      const platforms = platformsFor(profile.platform);
      const hasOtaProfile = profile.ota !== undefined;
      // OTA upload runs once per app × profile; platform:all exports a
      // universal bundle. Prefer the android leg (ubuntu, cheapest runner).
      const uploadPlatform = platforms.includes('android') ? 'android' : platforms[0];
      for (const platform of platforms) {
        if (platform === 'ios') hasIos = true;
        for (const secret of secretsFor(platform, profile.distribution)) {
          secretUnion.add(secret);
        }
        releaseLegs.push({
          app: app.slug,
          dir: legDir(app.dir),
          profile: profileName,
          platform,
          runsOn: platform === 'ios' ? 'macos-latest' : 'ubuntu-latest',
          ota: hasOtaProfile,
          otaUpload: hasOtaProfile && platform === uploadPlatform,
          otaServer: profile.ota?.server ?? '',
          otaChannel: profile.ota?.channel ?? '',
        });
      }
    }
  }

  const secrets = [...secretUnion].sort();
  const hasOta = releaseLegs.some((leg) => leg.ota);

  const content = renderTemplate('github/workflow-matrix.ejs', {
    packageManager,
    qualityLegsJson: JSON.stringify(qualityLegs),
    releaseLegsJson: JSON.stringify(releaseLegs),
    hasQuality: qualityLegs.length > 0,
    hasOta,
    secrets,
    matchAuth: hasIos && secrets.includes('MATCH_PASSWORD'),
  });

  return { path: `${workflowsDir}/${MATRIX_WORKFLOW_FILENAME}`, content };
}
