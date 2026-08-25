import { describe, expect, test } from 'bun:test';
import type { Config } from '../src/config/schema.ts';
import { deriveRequiredSecrets } from '../src/utils/secrets.ts';
import { generateGithubActions } from '../src/generators/github-actions.ts';
import { generateGitlab } from '../src/generators/gitlab.ts';

/**
 * Cross-check: derive the "actually required" secret set straight from what
 * the CI generators render, instead of trusting `deriveRequiredSecrets`'s own
 * hand-built table. `deriveRequiredSecrets(config)` must equal this set
 * exactly for every fixture below, or the SETUP.md / terminal summary lies
 * about what CI needs to build.
 *
 * Source of truth per provider:
 *  - github-actions: every `${{ secrets.NAME }}` in the rendered workflow(s).
 *  - gitlab: every `NAME: $NAME` declared in the rendered `variables:` block.
 */

function secretsRenderedByGithub(config: Config): Set<string> {
  const files = generateGithubActions(config);
  const names = new Set<string>();
  for (const { content } of files) {
    for (const m of content.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g)) {
      names.add(m[1]!);
    }
  }
  return names;
}

function secretsRenderedByGitlab(config: Config): Set<string> {
  const { content } = generateGitlab(config)[0]!;
  const names = new Set<string>();
  for (const m of content.matchAll(/^\s*([A-Z0-9_]+):\s*\$\1\s*$/gm)) {
    names.add(m[1]!);
  }
  return names;
}

function derivedNames(config: Config): string[] {
  return deriveRequiredSecrets(config)
    .map((s) => s.name)
    .sort();
}

interface Case {
  label: string;
  config: Config;
}

const githubCases: Case[] = [
  {
    label: 'ios testflight, no developmentTeam/match configured',
    config: {
      project: { type: 'bare', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'github-actions',
      build: { production: { platform: 'ios', distribution: 'testflight' } },
    },
  },
  {
    label: 'ios store, developmentTeam + match.gitUrl set (post-#32) — workflow still renders MATCH_GIT_URL/APPLE_TEAM_ID unconditionally',
    config: {
      project: {
        type: 'bare',
        bundleId: 'com.test',
        packageName: 'com.test',
        ios: { developmentTeam: 'AB12CD34EF', match: { gitUrl: 'https://github.com/org/certs.git' } },
      },
      ci: 'github-actions',
      build: { production: { platform: 'ios', distribution: 'store' } },
    },
  },
  {
    label: 'android firebase only',
    config: {
      project: { type: 'bare', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'github-actions',
      build: { staging: { platform: 'android', distribution: 'firebase' } },
    },
  },
  {
    label: 'android github-releases',
    config: {
      project: { type: 'bare', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'github-actions',
      build: { staging: { platform: 'android', distribution: 'github-releases' } },
    },
  },
  {
    label: 'all platforms, testflight+firebase (union)',
    config: {
      project: { type: 'bare', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'github-actions',
      build: { staging: { platform: 'all', distribution: 'testflight+firebase' } },
    },
  },
  {
    label: 'android store, ota configured — OTA_UPLOAD_KEY required on github',
    config: {
      project: { type: 'bare', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'github-actions',
      build: {
        production: {
          platform: 'android',
          distribution: 'store',
          ota: { server: 'https://ota.example.com', channel: 'production' },
        },
      },
    },
  },
];

const gitlabCases: Case[] = [
  {
    label: 'all platforms, testflight+firebase on gitlab',
    config: {
      project: { type: 'expo', bundleId: 'com.myapp', packageName: 'com.myapp' },
      ci: 'gitlab',
      build: { staging: { platform: 'all', distribution: 'testflight+firebase' } },
    },
  },
  {
    label: 'android store, ota configured on gitlab — gitlab ignores ota, no OTA_UPLOAD_KEY',
    config: {
      project: { type: 'bare', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'gitlab',
      build: {
        production: {
          platform: 'android',
          distribution: 'store',
          ota: { server: 'https://ota.example.com', channel: 'production' },
        },
      },
    },
  },
  {
    label: 'android github-releases on gitlab — still needs GITHUB_TOKEN',
    config: {
      project: { type: 'bare', bundleId: 'com.test', packageName: 'com.test' },
      ci: 'gitlab',
      build: { staging: { platform: 'android', distribution: 'github-releases' } },
    },
  },
];

describe('deriveRequiredSecrets cross-checked against rendered output', () => {
  describe('github-actions', () => {
    for (const { label, config } of githubCases) {
      test(label, () => {
        const rendered = [...secretsRenderedByGithub(config)].sort();
        expect(derivedNames(config)).toEqual(rendered);
      });
    }
  });

  describe('gitlab', () => {
    for (const { label, config } of gitlabCases) {
      test(label, () => {
        const rendered = [...secretsRenderedByGitlab(config)].sort();
        expect(derivedNames(config)).toEqual(rendered);
      });
    }
  });
});
