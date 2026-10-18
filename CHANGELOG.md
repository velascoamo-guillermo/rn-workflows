# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.3.0 - Unreleased

### BREAKING (configs with `ota`)

- Generated job names changed: `ota-<platform>` / `native-<platform>` replace
  `ota-update` and `save-fingerprint`.
- "Native release exists" is now looked up through git tags
  `rnw/native/...` instead of the Actions cache. The legacy cache marker is
  **not** read, so the first run per platform after upgrading rebuilds
  natively once.
- `runtimeVersion` is resolved per platform with
  `expo-updates runtimeversion:resolve`; the run fails if a 2-platform app
  resolves the same value for both (use the `fingerprint` policy).
- The Play track defaults to `internal` when `ota` is set (set
  `android.track` to override).
- With `ota`, the iOS lane stops at TestFlight: a `store` target uploads to
  TestFlight and never calls `upload_to_app_store` (submit from App Store
  Connect).
- With `ota`, native lanes set their own build numbers: iOS uses the latest
  TestFlight build + 1 (`increment_build_number`), Android the highest Play
  versionCode across tracks + 1 (`android.injected.version.code`). Manual
  `ios.buildNumber` / `android.versionCode` values are overridden.

- `generate --matrix` workflows with `ota` are now push-triggered (with
  change detection): OTA matrix apps ship on every push to the profile
  branch, not only on `v*` tags.
- Per-app `generate` no longer writes a per-app workflow when the git root
  already has `.github/workflows/rn-release-matrix.yml`; it writes Fastlane
  files (and SETUP.md) only.

### Added

- `ota.stagingChannel`, `e2e.maestro` (`flows`, `platforms`, `iosDevice`),
  `ci.runners` and `ci.env` (with reserved-key validation).
- Self-hosted runner toolchain setup.
- Staging upload, e2e update-id guard, Maestro run and auto-promote to the
  production channel.
- `generate --matrix`: plan-time fingerprint routing, ota/native matrices; a
  native re-check that finds another run already released the fingerprint
  ships the commit as an OTA.
- OTA/e2e readiness checks and an "OTA updates" section in `SETUP.md`.
- Fresh-app acceptance tests for ota+e2e (single app and monorepo).

### Changed

- Upload hardening: `--form-string`, upload key passed via stdin, timeouts,
  non-2xx HTTP responses fail the job.
- All user/event/secret values reach generated `run:` scripts only through
  `env:`.

### Known limitations

- Android e2e is beta and unproven live.
- Matrix e2e cannot mix Expo and bare apps.
- The Maestro installer is not checksummed.
- The Android emulator is x86_64 only.

## 0.2.0 - 2026-08-04

### Added

- CI quality workflow running tests, typecheck, and lint (oxlint) on every push.
- Release workflow that publishes to npm on version tags, using OIDC trusted
  publishing with provenance (no long-lived npm token) and publishing
  prereleases under the `beta` dist-tag.
- `generate --matrix` app-matrix release workflow for monorepos with multiple
  apps.
- Monorepo support: workflows are emitted at the git root, with
  `ci.workflowsDir` (config) / `--workflows-dir` (flag) to control the output
  directory, unique per-app slugs on basename collisions, `ci.extraPaths` for
  apps depending on shared packages, and the emitted workflow's own path
  included in its trigger filters.
- Smart OTA workflow template, generated automatically when a build profile
  declares `ota` config.
- Quality-checks job (test, lint, typecheck) added to generated CI workflows.

### Fixed

- iOS Fastfile signing: `match` profile type is now correctly resolved to
  `AppStore` (previously fell through to `Development` for store builds),
  and the code-signing identity uses `Apple Distribution` instead of the
  legacy `iPhone Distribution`.
- Xcode scheme/workspace resolution: `project.scheme` wins when set, else the
  Expo `name` field is detected (matching what `expo prebuild` actually
  generates), else the bundle-id slug as before.
- Interactive menu no longer re-opens after `generate` completes — citty
  runs the parent command after a matched subcommand, so `generate` now
  exits cleanly on its own.

### Changed

- oxlint wired into CI as the linter for this project.

[Unreleased changes prior to 0.2.0 were published as `0.2.0-beta.0` through
`0.2.0-beta.20` prereleases.]
