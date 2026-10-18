import type { Config } from '../config/schema.ts';
import { yamlScalar } from '../utils/render.ts';

/** GitHub `runs-on` value: a single label or a label list. */
export type RunsOn = string | string[];

const DEFAULTS: Record<'android' | 'ios', string> = {
  ios: 'macos-latest',
  android: 'ubuntu-latest',
};

/** Runner for a platform build job: `ci.runners.<platform>` or the hosted default. */
export function runsOnFor(config: Config, platform: 'android' | 'ios'): RunsOn {
  return config.runners?.[platform] ?? DEFAULTS[platform];
}

/** A runner is self-hosted when its label list includes `self-hosted`. */
export function isSelfHosted(runsOn: RunsOn): boolean {
  return Array.isArray(runsOn) && runsOn.includes('self-hosted');
}

/** Render `runs-on`: plain scalar, or a YAML flow sequence for label lists. */
export function renderRunsOn(runsOn: RunsOn): string {
  if (typeof runsOn === 'string') return yamlScalar(runsOn);
  return `[${runsOn.map(yamlScalar).join(', ')}]`;
}

/** One OTA/native leg: an (optional app ×) build profile × platform. */
export interface LegRef {
  /** Monorepo app slug; omitted for single-app repos. */
  appSlug?: string;
  profile: string;
  platform: 'android' | 'ios';
}

/**
 * Git tag prefix marking "a native binary for this leg's runtimeVersion was
 * shipped": `rnw/native/[<slug>/]<profile>/<platform>`. The full tag is
 * `<prefix>/<hash>`; lookup via `git ls-remote`, durable unlike the cache.
 */
export function nativeTagPrefix({ appSlug, profile, platform }: LegRef): string {
  return ['rnw', 'native', ...(appSlug ? [appSlug] : []), profile, platform].join('/');
}

/** Concurrency group serializing a leg's OTA publishes: `rnw-[<slug>-]<profile>-<platform>`. */
export function legConcurrencyGroup({ appSlug, profile, platform }: LegRef): string {
  return ['rnw', ...(appSlug ? [appSlug] : []), profile, platform].join('-');
}

/**
 * actions/cache key for a leg's staging-patched e2e test binary:
 * `rnw-e2e-[<slug>-]<profile>-<platform>-<hash>`. `hash` is usually the
 * fingerprint job's output expression; cached at `$RUNNER_TEMP/rnw-e2e/<platform>`.
 */
export function e2eCacheKey(leg: LegRef, hash: string): string {
  return ['rnw', 'e2e', ...(leg.appSlug ? [leg.appSlug] : []), leg.profile, leg.platform, hash].join('-');
}
