# rn-workflows

[![npm version](https://img.shields.io/npm/v/rn-workflows.svg)](https://www.npmjs.com/package/rn-workflows)
[![CI](https://github.com/velascoamo-guillermo/rn-workflows/actions/workflows/ci.yml/badge.svg)](https://github.com/velascoamo-guillermo/rn-workflows/actions/workflows/ci.yml)

Open-source CLI alternative to EAS Workflows. Define build profiles in one YAML file, generate Fastlane lanes + GitHub Actions + GitLab CI pipelines automatically.

## Why

EAS Workflows (Expo) is paid SaaS, tied to Expo, not self-hostable. `rn-workflows` is the open equivalent: works with bare React Native and Expo, supports multiple CI providers, emits plain Fastlane so you can debug and extend locally.

## Install

```bash
npx rn-workflows init
npx rn-workflows generate
```

Or add as dev dependency:

```bash
npm install --save-dev rn-workflows
# or
bun add -d rn-workflows
```

## Commands

| Command | Description |
| --- | --- |
| `rn-workflows init` | Interactively create `rn-workflows.yml`. Use `--force` to overwrite. `--yes` skips prompts (scripting/CI) — flags: `--bundle-id`, `--package-name`, `--project-type`, `--scheme`, `--ci`, `--profiles` (comma-separated: `preview`, `staging`, `production`), `--distribution` (`+`-combinable, e.g. `testflight+firebase`). |
| `rn-workflows generate` | Generate Fastlane + CI files from config. Flags: `--ci <provider>`, `--dry-run`, `--config <path>`, `--cwd <dir>`, `--workflows-dir <dir>`, `--matrix`. |

## Config shape

```yaml
project:
  type: expo         # or bare
  bundleId: com.myapp
  packageName: com.myapp
  scheme: MyApp      # optional — Xcode scheme, i.e. ios/MyApp.xcworkspace

ci: github-actions   # or gitlab

build:
  preview:
    platform: android
    distribution: firebase
    android:
      buildType: apk
  staging:
    platform: all
    distribution: testflight+firebase
    ios:
      exportMethod: ad-hoc
  production:
    platform: all
    distribution: store
    android:
      buildType: aab
    ios:
      exportMethod: app-store
```

### `project.scheme`

The Xcode scheme is **not** derived from the bundle id. `expo prebuild` names the
Xcode project after the Expo `name` field in `app.json` (`name: "Pawlog"` →
`ios/Pawlog.xcworkspace`, scheme `Pawlog`), which frequently differs from the
bundle id slug.

Resolution order:

1. `project.scheme` in `rn-workflows.yml` (explicit — required for bare projects
   with a custom scheme, or Expo projects using a dynamic `app.config.js`)
2. `expo.name` from `app.json` / `app.config.json`, sanitized the same way
   `expo prebuild` sanitizes it (`My App` → `MyApp`), when `project.type: expo`
3. last segment of `bundleId` (legacy fallback)

### `project.ios`

App-wide iOS signing config (not per build profile):

```yaml
project:
  ios:
    developmentTeam: AB12CD34EF   # optional — Apple Developer Team ID
    match:
      gitUrl: https://github.com/myorg/certificates.git  # required if `match` is set
      storageMode: git            # optional — only "git" is supported today
```

- `developmentTeam` renders `team_id("...")` in `fastlane/Appfile` and adds
  `DEVELOPMENT_TEAM=<team>` to the manual-signing `xcargs` of every iOS lane in
  `fastlane/Fastfile`, so `xcodebuild` can resolve the `match` signing identity
  without a hand patch. When unset, `fastlane/Appfile` falls back to
  `team_id(ENV["APPLE_TEAM_ID"])` so CI can still supply a team via the
  environment.
- `match` emits `fastlane/Matchfile` (`git_url`, `storage_mode`,
  `app_identifier` from `project.bundleId`). Omit it to keep the current
  behavior of not generating a Matchfile.

## OTA updates and Maestro e2e (GitHub Actions)

Opt a build profile into a fingerprint-driven pipeline with `ota` (and optionally `e2e.maestro`). On push, each platform is routed independently: if a native release already exists for its fingerprint the change ships as an OTA update (uploaded to the staging channel, e2e-tested, then auto-promoted to the production channel); otherwise a native binary is built, e2e-tested, and uploaded to TestFlight / Play internal. Native lanes stop at the testing track (a `store` target uploads to TestFlight, not App Store review) and set their own build numbers: latest TestFlight build + 1 on iOS, highest Play versionCode + 1 on Android.

```yaml
ci:
  provider: github-actions
  runners:                       # optional, labels per platform job
    ios: [self-hosted, macos-arm]
    android: [self-hosted, linux]
  env:                           # optional, non-secret workflow-level env
    SENTRY_DISABLE_AUTO_UPLOAD: 'true'
build:
  production:
    platform: all
    distribution: testflight+store
    ota:
      server: https://ota.example.com
      channel: production        # production channel, promoted to automatically
      stagingChannel: staging    # optional, default `staging`
    e2e:
      maestro:
        flows: .maestro          # relative path of Maestro flows in the repo
        platforms: [ios]         # optional, default: the profile's platforms
        iosDevice: iPhone 16 Pro Max   # optional simulator name
```

| Key | Meaning |
| --- | --- |
| `ota.server` | Base URL of your Expo OTA server. |
| `ota.channel` | Production channel; the staged bundle is promoted here after e2e is green. |
| `ota.stagingChannel` | Channel the e2e test binary pulls from before promotion. Default `staging`; must differ from `channel`. |
| `e2e.maestro.flows` | Directory of Maestro flows (relative, no `..`). |
| `e2e.maestro.platforms` | Subset of `ios`, `android` to run e2e on. Defaults to the profile's platforms. |
| `e2e.maestro.iosDevice` | iOS simulator device name. |
| `ci.runners.ios` / `ci.runners.android` | Runner labels for platform jobs (self-hosted supported). |
| `ci.env` | Extra non-secret env vars. Keys with reserved prefixes (`RNW_`, `GITHUB_`, `RUNNER_`, `ACTIONS_`), secret names and loader-injection variables are rejected. |

Notes:

- The Play track defaults to `internal` when `ota` is set (override with `android.track`).
- Per-platform `runtimeVersion` comes from `expo-updates runtimeversion:resolve`. Use the `fingerprint` runtime-version policy: the CI run fails if a 2-platform app resolves the same value for both platforms.
- Your app must render `Updates.updateId` in an element with testID `rnw-update-id`; a generated Maestro pre-flow asserts it equals the staging update id before your flows run.
- `generate --matrix` supports the same keys per app and adds push-triggered change detection; Fastlane files remain per-app.
- Android e2e is beta (not yet proven live), a matrix cannot mix Expo and bare apps for e2e, the Maestro installer is not checksummed, and the Android emulator is x86_64 only.

## Supported distributions

| Key | Target |
| --- | --- |
| `firebase` | Firebase App Distribution |
| `testflight` | Apple TestFlight |
| `appcenter` | Microsoft App Center |
| `github-releases` | GitHub Releases artifact upload |
| `store` | Google Play + App Store |

Combine multiple targets with `+`, e.g. `testflight+firebase`.

## Required CI secrets

| Distribution | Android env vars | iOS env vars |
| --- | --- | --- |
| `firebase` | `FIREBASE_APP_ID_ANDROID`, `FIREBASE_SERVICE_ACCOUNT_JSON` | `FIREBASE_APP_ID_IOS`, `FIREBASE_SERVICE_ACCOUNT_JSON` |
| `testflight` | — | `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_CONTENT`, `ASC_KEY_IS_BASE64`, `APPLE_TEAM_ID` |
| `appcenter` | `APPCENTER_API_TOKEN`, `APPCENTER_OWNER_NAME`, `APPCENTER_APP_NAME_ANDROID` | `APPCENTER_API_TOKEN`, `APPCENTER_OWNER_NAME`, `APPCENTER_APP_NAME_IOS` |
| `store` | `PLAY_STORE_JSON_KEY` | `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_CONTENT`, `ASC_KEY_IS_BASE64`, `APPLE_TEAM_ID` |

`ASC_KEY_IS_BASE64` is `"true"` when `ASC_KEY_CONTENT` is stored base64-encoded, `"false"`/unset for raw `.p8` contents — set it if your CI secret store can't mask multiline values (e.g. GitLab); `rn-workflows setup` offers to encode it for you.

iOS jobs also require `MATCH_PASSWORD` and `MATCH_GIT_URL` for code signing via [fastlane match](https://docs.fastlane.tools/actions/match/).

> The table above is a general reference. `generate` now also prints the exact secrets *your* config needs — with ready `gh secret set NAME` (or `glab variable set NAME` for `ci: gitlab`) one-liners — and writes a `SETUP.md` next to `fastlane/` with the same list plus what each secret is and where to get it. `SETUP.md` is skipped when a config needs zero secrets. `rn-workflows setup` can collect and upload most of them for you.

## Generated files

Given `ci: github-actions`:
- `fastlane/Fastfile`, `fastlane/Appfile`, `fastlane/Pluginfile`, `Gemfile`
- `fastlane/Matchfile` when `project.ios.match` is set
- `.github/workflows/rn-<profile>.yml` for each profile

Given `ci: gitlab`:
- `fastlane/Fastfile`, `fastlane/Appfile`, `fastlane/Pluginfile`, `Gemfile`
- `fastlane/Matchfile` when `project.ios.match` is set
- `.gitlab-ci.yml` with one stage per profile × platform

Either way, `SETUP.md` is added next to `fastlane/` whenever the config requires at least one CI secret.

## Monorepos (matrix mode)

`rn-workflows generate --matrix` discovers every `rn-workflows.yml` under the git root and emits a single `strategy.matrix` release workflow (GitHub Actions only). Fastlane files stay per-app — run plain `generate` inside each app directory.

Where workflow files are written:

- **Single-app `generate`**: `--workflows-dir` flag > `ci.workflowsDir` from `rn-workflows.yml` > `<git root>/.github/workflows`. Relative values resolve against the app directory (`--cwd`).
- **`generate --matrix`**: the matrix file is one file shared by all apps, so per-app `ci.workflowsDir` values cannot apply individually. Precedence: `--workflows-dir` flag > unanimous `ci.workflowsDir` (used only when **every** discovered app declares the **same** value) > `<git root>/.github/workflows`. Relative values resolve against the git root. When apps declare divergent values (or only some declare one), the default is used and a warning names the ignored apps — pass `--workflows-dir` to pick a directory explicitly.

Declare `ci.workflowsDir` with the object form of `ci`:

```yaml
ci:
  provider: github-actions
  workflowsDir: ci/workflows
```

Per-app workflows in a monorepo trigger only on changes under the app directory. When the app also depends on shared code, declare `ci.extraPaths` — git-root-relative globs appended to the workflow's `on.push.paths` filter (the emitted workflow file's own path is always included, so editing the workflow re-triggers it):

```yaml
ci:
  provider: github-actions
  extraPaths:
    - packages/shared/**
    - package.json
```

## Verifying a release

CI can validate everything `generate` writes — the Fastfile parses (`ruby -c`), the
workflow YAML is well-formed, lint/typecheck/test pass — and it can build the app.
What it can't do is the actual TestFlight / Firebase App Distribution / Play Store
*upload*: that needs real Apple/Firebase/Google credentials that don't exist in a
public CI checkout, so this is a manual last-mile check, not something `generate`
or its test suite can automate away.

To confirm a release lane really ships:

1. Set every secret `SETUP.md` lists as required (`gh secret set NAME "<value>"`
   for GitHub Actions, `glab variable set NAME` for GitLab).
2. Trigger the workflow the way `build.<profile>` is wired to run — push to the
   matching branch, push a tag, or `gh workflow run rn-<profile>.yml` /
   `workflow_dispatch` (`glab ci run` on GitLab).
3. Watch the run through the upload step (`gh run watch`, or the Actions/Pipelines
   UI) and confirm the build actually lands in TestFlight / Firebase App
   Distribution / the Play Console — not just that the job went green.

Do this once per project (and again after any signing config change). It's the
only part of the pipeline `rn-workflows` itself can't verify for you.

## Requirements

- Node.js `>=20`

## Contributing

```bash
bun install
bun test        # run all tests
bun run build   # compile to dist/
```

Tests live in `tests/`. Snapshots in `tests/__snapshots__/` are committed — update with `bun test --update-snapshots` after intentional template changes.

### Development

`dist/index.js` is committed to the repo (consumers reference it directly, e.g.
`node ../../rn-workflows/dist/index.js`). Run `bun run build` before pushing any
`src/` change — CI fails the quality job if the committed `dist/` doesn't match
a fresh build (`Check dist is up to date` step). Bun's bundler output isn't
guaranteed stable across Bun versions, so CI (and ideally your local Bun) uses
the version pinned in `.bun-version`.

## License

MIT
