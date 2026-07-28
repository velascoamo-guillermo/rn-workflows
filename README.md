# rn-workflows

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
| `rn-workflows init` | Interactively create `rn-workflows.yml`. Use `--force` to overwrite. |
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
| `testflight` | — | `APP_STORE_CONNECT_API_KEY_PATH`, `APPLE_TEAM_ID` |
| `appcenter` | `APPCENTER_API_TOKEN`, `APPCENTER_OWNER_NAME`, `APPCENTER_APP_NAME_ANDROID` | `APPCENTER_API_TOKEN`, `APPCENTER_OWNER_NAME`, `APPCENTER_APP_NAME_IOS` |
| `store` | `PLAY_STORE_JSON_KEY` | `APP_STORE_CONNECT_API_KEY_PATH`, `APPLE_TEAM_ID` |

iOS jobs also require `MATCH_PASSWORD` and `MATCH_GIT_URL` for code signing via [fastlane match](https://docs.fastlane.tools/actions/match/).

## Generated files

Given `ci: github-actions`:
- `fastlane/Fastfile`, `fastlane/Appfile`, `fastlane/Pluginfile`, `Gemfile`
- `.github/workflows/rn-<profile>.yml` for each profile

Given `ci: gitlab`:
- `fastlane/Fastfile`, `fastlane/Appfile`, `fastlane/Pluginfile`, `Gemfile`
- `.gitlab-ci.yml` with one stage per profile × platform

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

## Requirements

- Node.js `>=20`

## Contributing

```bash
bun install
bun test        # run all tests
bun run build   # compile to dist/
```

Tests live in `tests/`. Snapshots in `tests/__snapshots__/` are committed — update with `bun test --update-snapshots` after intentional template changes.

## License

MIT
