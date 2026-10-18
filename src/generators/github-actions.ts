import { e2ePlatforms, resolveStagingChannel, type Config } from '../config/schema.ts';
import { renderTemplate, yamlScalar } from '../utils/render.ts';
import { platformsFor, secretsFor } from '../secrets.ts';
import {
  e2eCacheKey,
  isSelfHosted,
  legConcurrencyGroup,
  nativeTagPrefix,
  renderRunsOn,
  runsOnFor,
} from './github-shared.ts';
import { resolveScheme, type GeneratedFile } from './fastlane.ts';

/** Maestro CLI version pinned in the conditional install. */
export const MAESTRO_VERSION = '2.11.0';
/** reactivecircus/android-emulator-runner, pinned to a full release tag. */
export const EMULATOR_RUNNER_VERSION = 'v2.38.0';

/** Per-leg e2e view for the smart workflow partials (YAML-rendered values). */
interface E2eView {
  cacheKey: string;
  stagingChannel: string;
  flows: string;
  appId: string;
  scheme: string;
  iosDevice?: string;
}

const DEFAULT_BRANCH: Record<string, string> = {
  preview: 'develop',
  staging: 'staging',
  production: 'main',
};

function branchFor(profileName: string): string {
  return DEFAULT_BRANCH[profileName] ?? 'main';
}

/** Command prefix for the Expo CLI under the project's package manager. */
function expoCliFor(packageManager: 'yarn' | 'npm' | 'bun'): string {
  if (packageManager === 'bun') return 'bunx expo';
  if (packageManager === 'npm') return 'npx expo';
  return 'yarn expo';
}

export interface GithubActionsOptions {
  packageManager?: 'yarn' | 'npm' | 'bun';
  /** Directory workflow files are emitted into. Default: `.github/workflows`. */
  workflowsDir?: string;
  /**
   * Posix-relative path from the git root to the app directory.
   * When set (monorepo), workflows get an `on.push.paths` filter scoped to
   * this subdir, per-job `defaults.run.working-directory` on jobs that check
   * out code, and app-dir-aware action inputs (setup-ruby working-directory,
   * setup-node cache-dependency-path, actions/cache paths).
   */
  appDir?: string;
  /** Filename prefix to avoid collisions between apps in the same monorepo. */
  appSlug?: string;
  /**
   * Posix-relative path from the git root to the directory workflow files are
   * emitted into. Used to include each workflow file's own path in its
   * `on.push.paths` filter (so edits to the workflow itself trigger a run).
   * Default: `.github/workflows`.
   */
  workflowsPathFromRoot?: string;
  /** Auto-detected Xcode scheme (e2e simulator build), used only when `project.scheme` is unset. */
  scheme?: string;
}

export function generateGithubActions(
  config: Config,
  options: GithubActionsOptions = {},
): GeneratedFile[] {
  const packageManager = options.packageManager ?? 'yarn';
  const workflowsDir = options.workflowsDir ?? '.github/workflows';
  const appDir = options.appDir ?? '';
  const slugPrefix = options.appSlug ? `${options.appSlug}-` : '';
  const workflowsPathFromRoot = options.workflowsPathFromRoot ?? '.github/workflows';
  const extraPaths = config.extraPaths ?? [];
  const scheme = resolveScheme(config, options.scheme);
  const files: GeneratedFile[] = [];

  for (const [name, profile] of Object.entries(config.build)) {
    const platforms = platformsFor(profile.platform);
    const jobEnv = Object.entries(config.env ?? {}).map(([key, value]) => ({
      key,
      value: yamlScalar(value),
    }));
    const e2eLegs = profile.ota && profile.e2e ? e2ePlatforms(profile) : [];
    const jobs = platforms.map((platform) => {
      const runsOn = runsOnFor(config, platform);
      const leg = { appSlug: options.appSlug, profile: name, platform };
      const hashExpr = `\${{ needs.fingerprint.outputs.${platform}_hash }}`;
      const maestro = profile.e2e?.maestro;
      const e2e: E2eView | undefined =
        profile.ota && maestro && e2eLegs.includes(platform)
          ? {
              cacheKey: yamlScalar(e2eCacheKey(leg, hashExpr)),
              stagingChannel: yamlScalar(resolveStagingChannel(profile.ota)),
              flows: yamlScalar(maestro.flows),
              appId: yamlScalar(
                platform === 'ios'
                  ? config.project.bundleId
                  : (config.project.packageName ?? config.project.bundleId),
              ),
              scheme: yamlScalar(scheme),
              ...(maestro.iosDevice ? { iosDevice: yamlScalar(maestro.iosDevice) } : {}),
            }
          : undefined;
      return {
        id: `build-${platform}`,
        name: `Build ${name} (${platform})`,
        platform,
        lane: name,
        runsOn: renderRunsOn(runsOn),
        selfHosted: isSelfHosted(runsOn),
        env: jobEnv,
        secrets: secretsFor(platform, profile.distribution),
        // Smart (OTA) workflow only; unused by workflow.ejs.
        tagPrefix: yamlScalar(nativeTagPrefix(leg)),
        concurrencyGroup: yamlScalar(legConcurrencyGroup(leg)),
        hashExpr,
        e2e,
      };
    });

    const checks = config.checks ?? {};
    const hasChecks = checks.test || checks.lint || checks.typecheck;

    const filename = `rn-${slugPrefix}${name}.yml`;
    const templateData = {
      workflowName: `rn-workflows • ${name}`,
      branch: branchFor(name),
      jobs,
      packageManager,
      checks,
      hasChecks,
      appDir,
      extraPaths,
      selfPath: `${workflowsPathFromRoot}/${filename}`,
    };

    const templateName = profile.ota
      ? 'github/workflow-smart.ejs'
      : 'github/workflow.ejs';

    const content = renderTemplate(templateName, {
      ...templateData,
      ...(profile.ota
        ? {
            otaServer: yamlScalar(profile.ota.server),
            otaChannel: yamlScalar(profile.ota.channel),
            expoCli: expoCliFor(packageManager),
            projectType: config.project.type,
            maestroVersion: MAESTRO_VERSION,
            emulatorRunnerVersion: EMULATOR_RUNNER_VERSION,
          }
        : {}),
    });

    files.push({ path: `${workflowsDir}/${filename}`, content });
  }

  return files;
}
