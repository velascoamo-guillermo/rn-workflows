import { z } from 'zod';

export const PLATFORMS = ['android', 'ios', 'all'] as const;
export const DISTRIBUTIONS = [
  'firebase',
  'testflight',
  'github-releases',
  'store',
] as const;
export const CI_PROVIDERS = ['github-actions', 'gitlab'] as const;
export const PROJECT_TYPES = ['expo', 'bare'] as const;

// `yamlScalar`/`yamlSingleQuoted` render these as single-quoted YAML scalars
// when they contain unsafe characters; per the YAML spec, a raw newline
// inside a single-quoted scalar is *folded* into a space on parse (and
// double-quoted scalars would need block-scalar handling to preserve it
// either way) — so a value containing `\n` never round-trips byte-for-byte
// through generated YAML. These are names/paths/URLs; a newline is never a
// legitimate value, so reject it up front instead of trying to preserve it.
const SINGLE_LINE_PATTERN = /^[^\r\n]*$/;
const SINGLE_LINE_MESSAGE = 'must not contain newlines';

export const PlatformSchema = z.enum(PLATFORMS);
export const DistributionSchema = z.enum(DISTRIBUTIONS);
export const CiSchema = z.enum(CI_PROVIDERS);
export const ProjectTypeSchema = z.enum(PROJECT_TYPES);

export type Platform = z.infer<typeof PlatformSchema>;
export type Distribution = z.infer<typeof DistributionSchema>;
export type CiProvider = z.infer<typeof CiSchema>;
export type ProjectType = z.infer<typeof ProjectTypeSchema>;

const DistributionStringSchema = z
  .string()
  .min(1, 'distribution cannot be empty')
  .superRefine((raw, ctx) => {
    const targets = raw.split('+').map((s) => s.trim());
    const unknown = targets.filter(
      (t) => !(DISTRIBUTIONS as readonly string[]).includes(t),
    );
    if (unknown.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: `distribution "${raw}" has unknown targets (${unknown.join(', ')}). Valid: ${DISTRIBUTIONS.join(', ')}. Combine with "+".`,
      });
    }
  });

export const AndroidBuildOptionsSchema = z.object({
  buildType: z.enum(['apk', 'aab']).optional(),
});

export const IosBuildOptionsSchema = z.object({
  exportMethod: z.enum(['app-store', 'ad-hoc', 'development']).optional(),
});

// `ota.server`/`ota.channel` land unquoted (or double-quoted) inside a raw
// shell `curl`/`-F` command in the generated GitHub Actions workflow — do not
// rely on escaping there, reject unsafe characters up front instead. This is
// a strict URL charset whitelist rather than a shell-unsafe-char blacklist:
// `<>(){}|;` and backtick/quote/space are all excluded (shell metacharacters
// or, for `<>&"'`, characters that `<%= %>`'s HTML-escaping would otherwise
// mangle when the value is interpolated raw into shell).
const OTA_SERVER_SAFE = /^https?:\/\/[A-Za-z0-9._~:/?#@%&=+-]+$/;
const OTA_CHANNEL_SAFE = /^[A-Za-z0-9_.-]+$/;

export const OtaConfigSchema = z.object({
  server: z
    .string()
    .min(1)
    .regex(OTA_SERVER_SAFE, 'ota.server must not contain whitespace or shell metacharacters'),
  channel: z
    .string()
    .min(1)
    .regex(
      OTA_CHANNEL_SAFE,
      'ota.channel may only contain letters, digits, dot, hyphen, underscore',
    ),
});

export type OtaConfig = z.infer<typeof OtaConfigSchema>;

export const BuildProfileSchema = z.object({
  platform: PlatformSchema,
  distribution: DistributionStringSchema,
  android: AndroidBuildOptionsSchema.optional(),
  ios: IosBuildOptionsSchema.optional(),
  ota: OtaConfigSchema.optional(),
});

export type BuildProfile = z.infer<typeof BuildProfileSchema>;

export const MatchConfigSchema = z.object({
  /** Git repo storing the `fastlane match` certificates/profiles. */
  gitUrl: z
    .string()
    .min(1, 'match.gitUrl cannot be empty')
    .regex(SINGLE_LINE_PATTERN, `match.gitUrl ${SINGLE_LINE_MESSAGE}`),
  /** Only "git" storage is supported today; matches match's own default. */
  storageMode: z.literal('git').optional(),
});

export type MatchConfig = z.infer<typeof MatchConfigSchema>;

// `developmentTeam` is interpolated into Fastfile's `xcargs:` string, itself
// a shell command line fastlane passes to `xcodebuild` — escaping alone is
// not enough there (see bundleId below), so this is a charset whitelist
// matching Apple's real Team ID format instead.
const TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/;

export const IosProjectConfigSchema = z.object({
  /** Apple Developer Team ID, e.g. "AB12CD34EF". App-wide, not per-profile. */
  developmentTeam: z
    .string()
    .min(1, 'developmentTeam cannot be empty')
    .regex(TEAM_ID_PATTERN, 'developmentTeam must be a 10-character Apple Team ID (A-Z, 0-9)')
    .optional(),
  match: MatchConfigSchema.optional(),
});

export type IosProjectConfig = z.infer<typeof IosProjectConfigSchema>;

// bundleId is interpolated into Fastfile's `xcargs:` shell string inside a
// single-quoted PROVISIONING_PROFILE_SPECIFIER value — escaping can't safely
// undo a value that breaks out of that shell quoting, so this is a charset
// whitelist (standard reverse-DNS bundle id shape) rather than an escape.
const BUNDLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export const ProjectSchema = z.object({
  type: ProjectTypeSchema,
  bundleId: z
    .string()
    .min(1)
    .regex(
      BUNDLE_ID_PATTERN,
      'bundleId may only contain letters, digits, dot, hyphen, underscore (unsafe otherwise for shell/xcargs interpolation)',
    ),
  packageName: z
    .string()
    .min(1)
    .regex(SINGLE_LINE_PATTERN, `packageName ${SINGLE_LINE_MESSAGE}`),
  /**
   * Xcode scheme / project name, i.e. `ios/<scheme>.xcworkspace`.
   * For Expo projects this is derived from `expo.name` in app.json by
   * `expo prebuild` — NOT from the bundle id. Leave unset to auto-detect
   * (Expo) or fall back to the last segment of `bundleId`.
   */
  scheme: z
    .string()
    .min(1)
    .regex(SINGLE_LINE_PATTERN, `scheme ${SINGLE_LINE_MESSAGE}`)
    .optional(),
  /** App-wide iOS signing config: development team id and `fastlane match` repo. */
  ios: IosProjectConfigSchema.optional(),
});

export const ChecksSchema = z.object({
  test: z.boolean().optional(),
  lint: z.boolean().optional(),
  typecheck: z.boolean().optional(),
});

export type Checks = z.infer<typeof ChecksSchema>;

export const CiObjectSchema = z.object({
  provider: CiSchema,
  workflowsDir: z
    .string()
    .min(1, 'workflowsDir cannot be empty')
    .regex(SINGLE_LINE_PATTERN, `workflowsDir ${SINGLE_LINE_MESSAGE}`)
    .optional(),
  extraPaths: z
    .array(
      z
        .string()
        .min(1, 'extraPaths entries cannot be empty')
        .regex(SINGLE_LINE_PATTERN, `extraPaths entries ${SINGLE_LINE_MESSAGE}`),
    )
    .optional(),
});

export interface Config {
  project: z.infer<typeof ProjectSchema>;
  ci: CiProvider;
  checks?: Checks;
  build: Record<string, BuildProfile>;
  /** From `ci.workflowsDir` — overrides where GitHub workflow files are emitted. */
  workflowsDir?: string;
  /**
   * From `ci.extraPaths` — git-root-relative globs appended to the
   * `on.push.paths` filter of monorepo per-app workflows (shared packages).
   */
  extraPaths?: string[];
}

const BUILD_PROFILE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

export const ConfigSchema = z
  .object({
    project: ProjectSchema,
    ci: z.union([CiSchema, CiObjectSchema]),
    checks: ChecksSchema.optional(),
    build: z.record(z.string().min(1), BuildProfileSchema),
  })
  .superRefine((cfg, ctx) => {
    const profiles = Object.entries(cfg.build);
    if (profiles.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['build'],
        message: 'at least one build profile is required',
      });
    }
    for (const [name, profile] of profiles) {
      // Build profile keys become a bare Fastlane lane name (`lane :<name>`)
      // and a raw shell argument (`bundle exec fastlane <platform> <name>`)
      // in the generated CI scripts. Neither position can be safely escaped
      // after the fact, so the charset is whitelisted up front.
      if (!BUILD_PROFILE_NAME_PATTERN.test(name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['build', name],
          message: `build profile name "${name}" may only contain letters, digits, hyphen, underscore, and must start with a letter (unsafe otherwise as a Fastlane lane name / shell argument)`,
        });
      }

      const targets = profile.distribution.split('+').map((s) => s.trim());
      const touchesIos = profile.platform === 'ios' || profile.platform === 'all';
      const touchesAndroid = profile.platform === 'android' || profile.platform === 'all';

      if (targets.includes('store') && touchesAndroid) {
        const buildType = profile.android?.buildType ?? 'aab';
        if (buildType !== 'aab') {
          ctx.addIssue({
            code: 'custom',
            path: ['build', name, 'android', 'buildType'],
            message: 'Play Store upload requires buildType "aab"',
          });
        }
      }

      if (targets.includes('testflight') && !touchesIos) {
        ctx.addIssue({
          code: 'custom',
          path: ['build', name, 'platform'],
          message: 'distribution "testflight" requires platform "ios" or "all"',
        });
      }
    }
  })
  .transform((cfg): Config => {
    const ci = typeof cfg.ci === 'string' ? { provider: cfg.ci } : cfg.ci;
    const out: Config = {
      project: cfg.project,
      ci: ci.provider,
      build: cfg.build,
    };
    if (cfg.checks !== undefined) out.checks = cfg.checks;
    if (ci.workflowsDir !== undefined) out.workflowsDir = ci.workflowsDir;
    if (ci.extraPaths !== undefined) out.extraPaths = ci.extraPaths;
    return out;
  });
