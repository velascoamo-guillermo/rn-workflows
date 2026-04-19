import type { Distribution, Platform } from './config/schema.ts';

const ANDROID_SECRETS: Record<Distribution, string[]> = {
  firebase: ['FIREBASE_APP_ID_ANDROID', 'FIREBASE_SERVICE_ACCOUNT_JSON'],
  testflight: [],
  appcenter: ['APPCENTER_API_TOKEN', 'APPCENTER_OWNER_NAME', 'APPCENTER_APP_NAME_ANDROID'],
  'github-releases': ['GITHUB_TOKEN'],
  store: ['PLAY_STORE_JSON_KEY'],
};

const IOS_SECRETS: Record<Distribution, string[]> = {
  firebase: ['FIREBASE_APP_ID_IOS', 'FIREBASE_SERVICE_ACCOUNT_JSON'],
  testflight: ['APP_STORE_CONNECT_API_KEY_PATH', 'APPLE_TEAM_ID'],
  appcenter: ['APPCENTER_API_TOKEN', 'APPCENTER_OWNER_NAME', 'APPCENTER_APP_NAME_IOS'],
  'github-releases': ['GITHUB_TOKEN'],
  store: ['APP_STORE_CONNECT_API_KEY_PATH', 'APPLE_TEAM_ID'],
};

const IOS_SIGNING_SECRETS = ['MATCH_PASSWORD', 'MATCH_GIT_URL'];

export function secretsFor(
  platform: 'android' | 'ios',
  distributionRaw: string,
): string[] {
  const targets = distributionRaw.split('+').map((s) => s.trim()) as Distribution[];
  const map = platform === 'android' ? ANDROID_SECRETS : IOS_SECRETS;
  const set = new Set<string>();
  for (const target of targets) {
    for (const secret of map[target] ?? []) set.add(secret);
  }
  if (platform === 'ios') {
    for (const s of IOS_SIGNING_SECRETS) set.add(s);
  }
  return [...set].sort();
}

export function platformsFor(platform: Platform): Array<'android' | 'ios'> {
  if (platform === 'all') return ['android', 'ios'];
  return [platform];
}
