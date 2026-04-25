# Mermaid Diagrams in README

## Summary

Add two static Mermaid diagrams to `README.md` to visualize (1) tool architecture and (2) generated CI workflow steps.

## Approach

Static Mermaid blocks embedded directly in README. Renders natively on GitHub. No code changes required — diagrams are stable and don't need auto-generation.

## Placement

- New `## How it works` section inserted between "Why" and "Install" — contains tool architecture diagram.
- New `## Generated workflow` section inserted after "Generated files" — contains CI workflow diagram.

## Diagram 1 — Tool architecture (`flowchart LR`)

Shows data flow from config input through parsers and generators to output files.

```mermaid
flowchart LR
    A[rn-workflows.yml] --> B[Parser & Validator]
    B --> C{Generators}
    C --> D[Fastlane]
    C --> E[GitHub Actions]
    C --> F[GitLab CI]
    D --> G["fastlane/Fastfile\nfastlane/Appfile\nGemfile"]
    E --> H[".github/workflows/\nrn-profile.yml"]
    F --> I[.gitlab-ci.yml]
```

## Diagram 2 — Generated CI workflow (`flowchart TD`)

Shows the step sequence inside a generated GitHub Actions job, including platform branching and distribution targets.

```mermaid
flowchart TD
    A([push / workflow_dispatch]) --> B[Checkout]
    B --> C[Setup Node 20]
    C --> D[Setup Ruby 3.2]
    D --> E{platform?}
    E -->|android| F[Setup JDK 17]
    E -->|ios| G[skip JDK]
    F --> H[Install JS deps]
    G --> H
    H --> I["bundle exec fastlane\nplatform lane"]
    I --> J{distribution}
    J -->|firebase| K[Firebase App Distribution]
    J -->|testflight| L[TestFlight]
    J -->|store| M[Play Store / App Store]
    J -->|appcenter| N[App Center]
    J -->|github-releases| O[GitHub Release]
```

## Implementation

Single task: insert two sections with Mermaid blocks into `README.md`. No new files, no code changes.
