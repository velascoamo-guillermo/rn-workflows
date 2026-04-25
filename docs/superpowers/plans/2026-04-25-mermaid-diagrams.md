# Mermaid Diagrams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two Mermaid diagrams to README.md — one showing tool architecture, one showing the generated CI workflow.

**Architecture:** Static Mermaid blocks embedded in README.md. No code changes. Two new sections inserted at specific locations in the existing file.

**Tech Stack:** Markdown, Mermaid (GitHub-native rendering)

---

### Task 1: Insert `## How it works` section with tool architecture diagram

**Files:**
- Modify: `README.md` (after `## Why` section, before `## Install`)

- [ ] **Step 1: Insert section before `## Install`**

In `README.md`, find this exact line:

```
## Install
```

Insert the following block immediately before it (the mermaid fence uses triple backticks):

```
## How it works

[mermaid]
flowchart LR
    A[rn-workflows.yml] --> B[Parser & Validator]
    B --> C{Generators}
    C --> D[Fastlane]
    C --> E[GitHub Actions]
    C --> F[GitLab CI]
    D --> G["fastlane/Fastfile\nfastlane/Appfile\nGemfile"]
    E --> H[".github/workflows/\nrn-profile.yml"]
    F --> I[.gitlab-ci.yml]
[/mermaid]
```

Replace `[mermaid]` with ` ```mermaid ` and `[/mermaid]` with ` ``` `.

- [ ] **Step 2: Verify section order in README.md**

Confirm:
1. `## Why`
2. `## How it works` ← new
3. `## Install`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add tool architecture diagram to README"
```

---

### Task 2: Insert `## Generated workflow` section with CI workflow diagram

**Files:**
- Modify: `README.md` (after `## Generated files` section, before `## Requirements`)

- [ ] **Step 1: Insert section before `## Requirements`**

In `README.md`, find this exact line:

```
## Requirements
```

Insert the following block immediately before it (the mermaid fence uses triple backticks):

```
## Generated workflow

Each build profile produces a GitHub Actions workflow with this job structure:

[mermaid]
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
[/mermaid]
```

Replace `[mermaid]` with ` ```mermaid ` and `[/mermaid]` with ` ``` `.

- [ ] **Step 2: Verify section order in README.md**

Confirm:
1. `## Generated files`
2. `## Generated workflow` ← new
3. `## Requirements`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add generated CI workflow diagram to README"
```
