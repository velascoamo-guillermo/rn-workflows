import type { Config, BuildProfile } from '../config/schema.ts';
import { renderTemplate } from '../utils/render.ts';

export interface GeneratedFile {
  path: string;
  content: string;
}

interface AndroidProfileView {
  name: string;
  description: string;
  targets: string[];
  gradleTask: 'assemble' | 'bundle';
  isAab: boolean;
  androidArtifactPath: string;
}

interface IosProfileView {
  name: string;
  description: string;
  targets: string[];
  exportMethod: string;
  matchType: MatchType;
  provisioningProfileName: string;
  codeSignIdentity: string;
  xcWorkspace: string;
  xcScheme: string;
}

type MatchType = 'appstore' | 'adhoc' | 'development';

/** `match(type: X)` installs a profile literally named `match <Name> <bundleId>`. */
const MATCH_PROFILE_LABEL: Record<MatchType, string> = {
  appstore: 'AppStore',
  adhoc: 'AdHoc',
  development: 'Development',
};

/** Modern certificate names — `iPhone Distribution` is the legacy spelling. */
const CODE_SIGN_IDENTITY: Record<MatchType, string> = {
  appstore: 'Apple Distribution',
  adhoc: 'Apple Distribution',
  development: 'Apple Development',
};

export function matchTypeFor(exportMethod: string): MatchType {
  if (exportMethod === 'ad-hoc') return 'adhoc';
  if (exportMethod === 'development') return 'development';
  return 'appstore';
}

export function provisioningProfileName(matchType: MatchType, bundleId: string): string {
  return `match ${MATCH_PROFILE_LABEL[matchType]} ${bundleId}`;
}

export interface FastlaneOptions {
  packageManager?: 'yarn' | 'npm' | 'bun';
  /** Auto-detected Xcode scheme, used only when `project.scheme` is unset. */
  scheme?: string;
}

export function resolveScheme(config: Config, detectedScheme?: string): string {
  return (
    config.project.scheme ??
    detectedScheme ??
    config.project.bundleId.split('.').pop() ??
    'App'
  );
}

function toAndroidView(name: string, profile: BuildProfile): AndroidProfileView {
  const isAab = profile.android?.buildType === 'aab';
  const targets = profile.distribution.split('+').map((s) => s.trim());
  const artifactPath = isAab
    ? 'android/app/build/outputs/bundle/release/app-release.aab'
    : 'android/app/build/outputs/apk/release/app-release.apk';
  return {
    name,
    description: `Build ${name} (android)`,
    targets,
    gradleTask: isAab ? 'bundle' : 'assemble',
    isAab,
    androidArtifactPath: artifactPath,
  };
}

function toIosView(
  name: string,
  profile: BuildProfile,
  bundleId: string,
  scheme: string,
): IosProfileView {
  const exportMethod = profile.ios?.exportMethod ?? 'app-store';
  const targets = profile.distribution.split('+').map((s) => s.trim());
  const matchType = matchTypeFor(exportMethod);
  return {
    name,
    description: `Build ${name} (ios)`,
    targets,
    exportMethod,
    matchType,
    provisioningProfileName: provisioningProfileName(matchType, bundleId),
    codeSignIdentity: CODE_SIGN_IDENTITY[matchType],
    xcWorkspace: scheme,
    xcScheme: scheme,
  };
}

export function generateFastlane(
  config: Config,
  options: FastlaneOptions = {},
): GeneratedFile[] {
  const packageManager = options.packageManager ?? 'yarn';
  const scheme = resolveScheme(config, options.scheme);
  const androidProfiles: AndroidProfileView[] = [];
  const iosProfiles: IosProfileView[] = [];

  for (const [name, profile] of Object.entries(config.build)) {
    if (profile.platform === 'android' || profile.platform === 'all') {
      androidProfiles.push(toAndroidView(name, profile));
    }
    if (profile.platform === 'ios' || profile.platform === 'all') {
      iosProfiles.push(toIosView(name, profile, config.project.bundleId, scheme));
    }
  }

  const allTargets = new Set(
    Object.values(config.build).flatMap((p) => p.distribution.split('+').map((s) => s.trim())),
  );

  const fastfile = renderTemplate('fastlane/Fastfile.ejs', {
    androidProfiles,
    iosProfiles,
    defaultPlatform: androidProfiles.length > 0 ? 'android' : 'ios',
    projectType: config.project.type,
    bundleId: config.project.bundleId,
    packageName: config.project.packageName,
    packageManager,
    usesFirebase: allTargets.has('firebase'),
    hasIos: iosProfiles.length > 0,
    hasAndroidFirebase: androidProfiles.some((p) => p.targets.includes('firebase')),
    hasIosFirebase: iosProfiles.some((p) => p.targets.includes('firebase')),
  });

  const appfile = renderTemplate('fastlane/Appfile.ejs', {
    bundleId: config.project.bundleId,
    packageName: config.project.packageName,
  });

  const gemfile = renderTemplate('fastlane/Gemfile.ejs', {});

  const pluginfile = renderTemplate('fastlane/Pluginfile.ejs', {
    usesFirebase: allTargets.has('firebase'),
  });

  return [
    { path: 'fastlane/Fastfile', content: fastfile },
    { path: 'fastlane/Appfile', content: appfile },
    { path: 'fastlane/Pluginfile', content: pluginfile },
    { path: 'Gemfile', content: gemfile },
  ];
}
