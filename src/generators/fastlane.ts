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
  matchType: string;
  xcWorkspace: string;
  xcScheme: string;
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

function toIosView(name: string, profile: BuildProfile, bundleId: string): IosProfileView {
  const exportMethod = profile.ios?.exportMethod ?? 'app-store';
  const targets = profile.distribution.split('+').map((s) => s.trim());
  const matchType = exportMethod === 'app-store' ? 'appstore' : exportMethod === 'ad-hoc' ? 'adhoc' : 'development';
  const schemeName = bundleId.split('.').pop() ?? 'App';
  return {
    name,
    description: `Build ${name} (ios)`,
    targets,
    exportMethod,
    matchType,
    xcWorkspace: schemeName,
    xcScheme: schemeName,
  };
}

export function generateFastlane(config: Config): GeneratedFile[] {
  const androidProfiles: AndroidProfileView[] = [];
  const iosProfiles: IosProfileView[] = [];

  for (const [name, profile] of Object.entries(config.build)) {
    if (profile.platform === 'android' || profile.platform === 'all') {
      androidProfiles.push(toAndroidView(name, profile));
    }
    if (profile.platform === 'ios' || profile.platform === 'all') {
      iosProfiles.push(toIosView(name, profile, config.project.bundleId));
    }
  }

  const allTargets = new Set(
    Object.values(config.build).flatMap((p) => p.distribution.split('+').map((s) => s.trim())),
  );

  const fastfile = renderTemplate('fastlane/Fastfile.ejs', {
    androidProfiles,
    iosProfiles,
    projectType: config.project.type,
    bundleId: config.project.bundleId,
    packageName: config.project.packageName,
  });

  const appfile = renderTemplate('fastlane/Appfile.ejs', {
    bundleId: config.project.bundleId,
    packageName: config.project.packageName,
  });

  const gemfile = renderTemplate('fastlane/Gemfile.ejs', {});

  const pluginfile = renderTemplate('fastlane/Pluginfile.ejs', {
    usesFirebase: allTargets.has('firebase'),
    usesAppCenter: allTargets.has('appcenter'),
  });

  return [
    { path: 'fastlane/Fastfile', content: fastfile },
    { path: 'fastlane/Appfile', content: appfile },
    { path: 'fastlane/Pluginfile', content: pluginfile },
    { path: 'Gemfile', content: gemfile },
  ];
}
