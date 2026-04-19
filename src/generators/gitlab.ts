import type { Config } from '../config/schema.ts';
import { renderTemplate } from '../utils/render.ts';
import { platformsFor, secretsFor } from '../secrets.ts';
import type { GeneratedFile } from './fastlane.ts';

const DEFAULT_BRANCH: Record<string, string> = {
  preview: 'develop',
  staging: 'staging',
  production: 'main',
};

const ANDROID_IMAGE = 'reactnativecommunity/react-native-android:latest';
const IOS_IMAGE = 'macos-14-xcode-15';

export function generateGitlab(config: Config): GeneratedFile[] {
  const jobs: Array<{
    id: string;
    platform: 'android' | 'ios';
    lane: string;
    image: string;
    branch: string;
    secrets: string[];
  }> = [];

  for (const [name, profile] of Object.entries(config.build)) {
    const platforms = platformsFor(profile.platform);
    const branch = DEFAULT_BRANCH[name] ?? 'main';
    for (const platform of platforms) {
      jobs.push({
        id: `build:${name}:${platform}`,
        platform,
        lane: name,
        image: platform === 'android' ? ANDROID_IMAGE : IOS_IMAGE,
        branch,
        secrets: secretsFor(platform, profile.distribution),
      });
    }
  }

  const content = renderTemplate('gitlab/gitlab-ci.ejs', { jobs });
  return [{ path: '.gitlab-ci.yml', content }];
}
