import type { CiProvider, Config } from '../config/schema.ts';
import { platformsFor, secretsFor } from '../secrets.ts';

export interface SecretRequirement {
  name: string;
  description: string;
}

/**
 * Descriptions for every secret name `secretsFor` (src/secrets.ts, the same
 * function the GitHub/GitLab generators call) can return, plus the two
 * extras layered on only by the GitHub Actions templates
 * (`src/templates/github/workflow*.ejs`): `MATCH_GIT_BASIC_AUTHORIZATION`
 * and `OTA_UPLOAD_KEY`. `deriveRequiredSecrets` below computes the *names*
 * from `secretsFor`/the ota flag — the exact same inputs the generators
 * use — so this map only supplies human copy; it can never drift into a
 * name the renderer doesn't also require. Verified against rendered output
 * by `tests/secrets-cross-check.test.ts`.
 */
const SECRET_DESCRIPTIONS: Record<string, string> = {
  FIREBASE_APP_ID_ANDROID:
    'Firebase App Distribution app id for the Android app. Firebase console → Project settings → General → Your apps.',
  FIREBASE_APP_ID_IOS:
    'Firebase App Distribution app id for the iOS app. Firebase console → Project settings → General → Your apps.',
  FIREBASE_SERVICE_ACCOUNT_JSON:
    'Firebase service account JSON (full file contents) with App Distribution admin access. Firebase console → Project settings → Service accounts → Generate new private key.',
  PLAY_STORE_JSON_KEY:
    'Google Play service account JSON key with Release Manager access. Play Console → Setup → API access → Service accounts.',
  ASC_KEY_ID:
    'App Store Connect API key ID (10-character identifier shown next to the key). App Store Connect → Users and Access → Integrations → App Store Connect API.',
  ASC_ISSUER_ID:
    'App Store Connect API issuer ID (UUID shown above the keys table). App Store Connect → Users and Access → Integrations → App Store Connect API.',
  ASC_KEY_CONTENT:
    'Full contents of the downloaded .p8 private key file, pasted as-is (raw, not base64) — fastlane\'s `app_store_connect_api_key(key_content:)` reads it directly from this env var, no file materialization step needed. App Store Connect → Users and Access → Integrations → App Store Connect API → generate/download a key (only downloadable once, so save it).',
  APPLE_TEAM_ID:
    'Your 10-character Apple Developer Team ID. Read by fastlane\'s Appfile as a fallback whenever `project.ios.developmentTeam` is left unset in rn-workflows.yml — but the generated CI workflow declares this secret unconditionally for every testflight/store iOS job regardless, so set it either way. App Store Connect → Membership.',
  MATCH_PASSWORD:
    'Passphrase that decrypts the fastlane match certificates repo. Choose one when running `fastlane match init`.',
  MATCH_GIT_URL:
    'Git URL of the private repo storing fastlane match\'s encrypted certificates, e.g. `https://github.com/org/certificates.git`. Read directly by fastlane\'s `match` action from the environment. If `project.ios.match.gitUrl` is set in rn-workflows.yml the generated Matchfile also carries the URL, but the CI workflow still declares this secret unconditionally — set it regardless.',
  MATCH_GIT_BASIC_AUTHORIZATION:
    'Base64-encoded `username:token` with read access to the match certificates repo, e.g. `echo -n "user:token" | base64`.',
  GITHUB_TOKEN:
    'GitHub token with permission to create Releases on the app repo, used by the `github-releases` distribution target. On GitHub Actions the default `secrets.GITHUB_TOKEN` usually suffices (may need `contents: write` permission); on GitLab, create a personal access token against the GitHub repo instead.',
  OTA_UPLOAD_KEY:
    'Shared upload key the OTA server accepts on `/api/upload`. Set the same value on the OTA server and here. Only rendered for GitHub Actions today — the gitlab-ci generator does not emit an OTA job.',
};

function requirement(name: string): SecretRequirement {
  const description = SECRET_DESCRIPTIONS[name];
  if (!description) throw new Error(`No description registered for secret "${name}" — add one to SECRET_DESCRIPTIONS.`);
  return { name, description };
}

/**
 * Derives the CI secrets required by what `generate` actually renders for
 * this config, using the exact same `secretsFor`/`platformsFor` the
 * GitHub Actions and GitLab generators call to build each job's
 * env/variables block — so this can't drift from the render the way a
 * hand-maintained second table could.
 *
 * Two secrets are layered on top of `secretsFor`'s per-platform/per-target
 * set because they come from template-level logic instead
 * (`src/templates/github/workflow*.ejs`), and only on GitHub Actions —
 * the gitlab-ci.ejs template has no equivalent:
 *  - `MATCH_GIT_BASIC_AUTHORIZATION`: added whenever an iOS job carries
 *    `MATCH_PASSWORD` (i.e. every iOS job, per `secretsFor`).
 *  - `OTA_UPLOAD_KEY`: added whenever a build profile sets `ota` — only the
 *    GitHub `workflow-smart.ejs` template renders an OTA upload step;
 *    `generateGitlab` ignores `profile.ota` entirely.
 */
export function deriveRequiredSecrets(config: Config): SecretRequirement[] {
  const required = new Map<string, SecretRequirement>();
  const isGithub = config.ci === 'github-actions';

  for (const profile of Object.values(config.build)) {
    for (const platform of platformsFor(profile.platform)) {
      for (const name of secretsFor(platform, profile.distribution)) {
        required.set(name, requirement(name));
      }
      if (platform === 'ios' && isGithub) {
        required.set('MATCH_GIT_BASIC_AUTHORIZATION', requirement('MATCH_GIT_BASIC_AUTHORIZATION'));
      }
    }
    if (profile.ota && isGithub) {
      required.set('OTA_UPLOAD_KEY', requirement('OTA_UPLOAD_KEY'));
    }
  }

  return [...required.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function secretSetCommand(ci: CiProvider, name: string): string {
  return ci === 'gitlab' ? `glab variable set ${name}` : `gh secret set ${name}`;
}

export function buildSetupMarkdown(secrets: SecretRequirement[], ci: CiProvider): string {
  const lines: string[] = [
    '# CI secrets setup',
    '',
    'Auto-generated by `rn-workflows generate`. Regenerate with `npx rn-workflows generate`.',
    '',
    'These are the CI secrets the generated Fastlane and CI files read at build time.',
    '`rn-workflows setup` can collect and upload some of these for you — check each',
    'entry below, since not every secret here has a setup step yet.',
    '',
  ];

  for (const req of secrets) {
    lines.push(`## ${req.name}`, '', req.description, '', '```sh', `${secretSetCommand(ci, req.name)} "<value>"`, '```', '');
  }

  return lines.join('\n');
}
