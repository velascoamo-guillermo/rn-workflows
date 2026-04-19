import { z } from 'zod';

export const PLATFORMS = ['android', 'ios', 'all'] as const;
export const DISTRIBUTIONS = [
  'firebase',
  'testflight',
  'appcenter',
  'github-releases',
  'store',
] as const;
export const CI_PROVIDERS = ['github-actions', 'gitlab'] as const;
export const PROJECT_TYPES = ['expo', 'bare'] as const;

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

export const BuildProfileSchema = z.object({
  platform: PlatformSchema,
  distribution: DistributionStringSchema,
  android: AndroidBuildOptionsSchema.optional(),
  ios: IosBuildOptionsSchema.optional(),
});

export type BuildProfile = z.infer<typeof BuildProfileSchema>;

export const ProjectSchema = z.object({
  type: ProjectTypeSchema,
  bundleId: z.string().min(1),
  packageName: z.string().min(1),
});

export const ConfigSchema = z
  .object({
    project: ProjectSchema,
    ci: CiSchema,
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
  });

export type Config = z.infer<typeof ConfigSchema>;
