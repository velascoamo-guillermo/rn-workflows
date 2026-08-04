# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
