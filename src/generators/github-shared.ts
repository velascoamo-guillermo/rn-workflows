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
