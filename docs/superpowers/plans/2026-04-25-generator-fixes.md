# Generator Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four accuracy bugs in the generator: staging distribution logic, missing Xcode setup step, hardcoded match readonly, and hardcoded yarn package manager.

**Architecture:** Each fix is isolated. Tasks 1–3 are template/command patches. Task 4 adds package manager detection in `generate.ts` and threads it through both generators and both templates. No schema changes — detection is automatic from lock files.

**Tech Stack:** TypeScript, EJS templates, Bun test runner

---

## File Map

| File | Changes |
|---|---|
| `src/commands/init.ts` | Task 1: fix staging distribution |
| `src/templates/github/workflow.ejs` | Task 2: add Xcode step; Task 4: package manager cache |
| `tests/github-actions.test.ts` | Task 2: Xcode tests; Task 4: package manager tests |
| `src/templates/fastlane/Fastfile.ejs` | Task 3: match readonly; Task 4: install command |
| `tests/fastlane.test.ts` | Task 3: match test; Task 4: package manager test |
| `src/generators/fastlane.ts` | Task 4: accept options, pass packageManager |
| `src/generators/github-actions.ts` | Task 4: accept options, pass packageManager |
| `src/commands/generate.ts` | Task 4: detect package manager, pass to generators |
| `tests/__snapshots__/github-actions.test.ts.snap` | Task 2 + Task 4: update snapshots |

---

### Task 1: Fix staging distribution in init.ts

**Files:**
- Modify: `src/commands/init.ts:89-105`

The `staging` profile currently hardcodes `testflight+firebase` whenever firebase is selected. It should use whatever distributions the user picked, same as `preview` does.

- [ ] **Step 1: Replace the staging distribution logic**

In `src/commands/init.ts`, find this block (lines 96–104):

```ts
if (profiles.includes('staging')) {
  build.staging = {
    platform: 'all',
    distribution: distributions.includes('firebase')
      ? 'testflight+firebase'
      : 'testflight',
    android: { buildType: 'apk' },
    ios: { exportMethod: 'ad-hoc' },
  };
}
```

Replace with:

```ts
if (profiles.includes('staging')) {
  build.staging = {
    platform: 'all',
    distribution: previewDist,
    android: { buildType: 'apk' },
    ios: { exportMethod: 'ad-hoc' },
  };
}
```

`previewDist` is already defined on line 88 as `distributions.join('+')` — the user's actual selection.

- [ ] **Step 2: Verify by inspection**

Read `src/commands/init.ts` lines 85–115 and confirm:
- `previewDist` is still defined before `staging` block
- `preview` uses `previewDist` ✓
- `staging` now uses `previewDist` ✓
- `production` still uses `'store'` ✓

- [ ] **Step 3: Run tests**

```bash
bun test
```

Expected: all 35 tests pass (no tests cover init directly — it's an interactive CLI).

- [ ] **Step 4: Commit**

```bash
git add src/commands/init.ts
git commit -m "fix: staging profile uses user-selected distributions instead of forcing testflight"
```

---

### Task 2: Add Xcode setup step for iOS jobs in GitHub Actions workflow

**Files:**
- Modify: `src/templates/github/workflow.ejs`
- Modify: `tests/github-actions.test.ts`
- Update: `tests/__snapshots__/github-actions.test.ts.snap`

iOS jobs on macOS runners need to select a stable Xcode version. Without this, the runner uses whatever Xcode happens to be active, which can break silently when GitHub updates the runner image.

- [ ] **Step 1: Write the failing tests**

In `tests/github-actions.test.ts`, add these two tests after the `'ios job does not include JDK setup step'` test (around line 94):

```ts
test('ios job includes setup-xcode step', () => {
  const config: Config = {
    ...baseConfig,
    build: { preview: { platform: 'ios', distribution: 'testflight' } },
  };
  const { content } = generateGithubActions(config)[0];
  expect(content).toContain('maxim-lobanov/setup-xcode@v1');
  expect(content).toContain('xcode-version: latest-stable');
});

test('android job does not include setup-xcode step', () => {
  const { content } = generateGithubActions(baseConfig)[0];
  expect(content).not.toContain('setup-xcode');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/github-actions.test.ts
```

Expected: `ios job includes setup-xcode step` FAILS, `android job does not include setup-xcode step` PASSES.

- [ ] **Step 3: Add Xcode step to workflow template**

In `src/templates/github/workflow.ejs`, find this block (around line 30):

```ejs
      - name: Setup Ruby
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: 3.2
          bundler-cache: true

<% if (job.platform === 'android') { -%>
```

Replace with:

```ejs
      - name: Setup Ruby
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: 3.2
          bundler-cache: true

<% if (job.platform === 'ios') { -%>
      - name: Select Xcode
        uses: maxim-lobanov/setup-xcode@v1
        with:
          xcode-version: latest-stable

<% } -%>
<% if (job.platform === 'android') { -%>
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/github-actions.test.ts
```

Expected: all tests pass except `output matches snapshot` (snapshot is now stale).

- [ ] **Step 5: Update snapshot**

```bash
bun test --update-snapshots
```

Expected: snapshot updated, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/templates/github/workflow.ejs tests/github-actions.test.ts tests/__snapshots__/github-actions.test.ts.snap
git commit -m "fix: add Xcode setup step for iOS jobs in GitHub Actions workflow"
```

---

### Task 3: Fix hardcoded match readonly in Fastfile

**Files:**
- Modify: `src/templates/fastlane/Fastfile.ejs:59`
- Modify: `tests/fastlane.test.ts`

`readonly: true` on the `match` call means the first CI run fails if certificates haven't been seeded yet. Making it configurable via `MATCH_READONLY` env var lets teams seed certs by setting `MATCH_READONLY=false` on their first run.

- [ ] **Step 1: Write the failing test**

In `tests/fastlane.test.ts`, add this test after the `'Pluginfile lists firebase plugin when used'` test:

```ts
it('Fastfile match call uses MATCH_READONLY env var instead of hardcoded true', () => {
  const cfg = parseConfig(fixture('production-all.yml'));
  const fastfile = generateFastlane(cfg).find((f) => f.path === 'fastlane/Fastfile')!;
  expect(fastfile.content).toContain('MATCH_READONLY');
  expect(fastfile.content).not.toContain('readonly: true');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/fastlane.test.ts
```

Expected: `Fastfile match call uses MATCH_READONLY env var instead of hardcoded true` FAILS.

- [ ] **Step 3: Fix the match line in the template**

In `src/templates/fastlane/Fastfile.ejs`, find line 59:

```ejs
    match(type: "<%= profile.matchType %>", readonly: true) if ENV["MATCH_PASSWORD"]
```

Replace with:

```ejs
    match(type: "<%= profile.matchType %>", readonly: ENV.fetch("MATCH_READONLY", "true") == "true") if ENV["MATCH_PASSWORD"]
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/fastlane.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/templates/fastlane/Fastfile.ejs tests/fastlane.test.ts
git commit -m "fix: make match readonly configurable via MATCH_READONLY env var"
```

---

### Task 4: Auto-detect package manager and use correct install command

**Files:**
- Modify: `src/generators/fastlane.ts`
- Modify: `src/generators/github-actions.ts`
- Modify: `src/commands/generate.ts`
- Modify: `src/templates/fastlane/Fastfile.ejs`
- Modify: `src/templates/github/workflow.ejs`
- Modify: `tests/fastlane.test.ts`
- Modify: `tests/github-actions.test.ts`
- Update: `tests/__snapshots__/github-actions.test.ts.snap`

The Fastfile and workflow templates hardcode `yarn install --frozen-lockfile`. Detect the package manager from lock files in `generate.ts` and pass it through both generators to both templates.

Lock file detection priority: `bun.lock` / `bun.lockb` → `bun`; `yarn.lock` → `yarn`; `package-lock.json` → `npm`; default → `yarn`.

Install commands: `yarn install --frozen-lockfile` | `npm ci` | `bun install --frozen-lockfile`.

Cache key for `actions/setup-node`: `yarn` | `npm` | `bun`.

- [ ] **Step 1: Write failing tests for generators**

In `tests/fastlane.test.ts`, add after the match test:

```ts
it('uses bun install when packageManager is bun', () => {
  const cfg = parseConfig(fixture('preview-android.yml'));
  const fastfile = generateFastlane(cfg, { packageManager: 'bun' }).find(
    (f) => f.path === 'fastlane/Fastfile',
  )!;
  expect(fastfile.content).toContain('bun install --frozen-lockfile');
  expect(fastfile.content).not.toContain('yarn install');
});

it('uses npm ci when packageManager is npm', () => {
  const cfg = parseConfig(fixture('preview-android.yml'));
  const fastfile = generateFastlane(cfg, { packageManager: 'npm' }).find(
    (f) => f.path === 'fastlane/Fastfile',
  )!;
  expect(fastfile.content).toContain('npm ci');
  expect(fastfile.content).not.toContain('yarn install');
});
```

In `tests/github-actions.test.ts`, add after the existing tests:

```ts
test('bun project uses bun install and bun cache', () => {
  const { content } = generateGithubActions(baseConfig, { packageManager: 'bun' })[0];
  expect(content).toContain('bun install --frozen-lockfile');
  expect(content).toContain('cache: bun');
  expect(content).not.toContain('yarn install');
});

test('npm project uses npm ci and npm cache', () => {
  const { content } = generateGithubActions(baseConfig, { packageManager: 'npm' })[0];
  expect(content).toContain('npm ci');
  expect(content).toContain('cache: npm');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/fastlane.test.ts tests/github-actions.test.ts
```

Expected: the 4 new tests FAIL (generators don't accept options yet).

- [ ] **Step 3: Update fastlane generator signature**

In `src/generators/fastlane.ts`, change the `generateFastlane` signature and template render call:

```ts
export function generateFastlane(
  config: Config,
  options: { packageManager?: 'yarn' | 'npm' | 'bun' } = {},
): GeneratedFile[] {
  const packageManager = options.packageManager ?? 'yarn';
  // ... (rest of existing code unchanged until renderTemplate call)

  const fastfile = renderTemplate('fastlane/Fastfile.ejs', {
    androidProfiles,
    iosProfiles,
    projectType: config.project.type,
    bundleId: config.project.bundleId,
    packageName: config.project.packageName,
    packageManager,
  });
```

Only the function signature line and the `renderTemplate` call for `fastfile` change. Everything else stays the same.

- [ ] **Step 4: Update github-actions generator signature**

In `src/generators/github-actions.ts`, change the `generateGithubActions` signature and template render call:

```ts
export function generateGithubActions(
  config: Config,
  options: { packageManager?: 'yarn' | 'npm' | 'bun' } = {},
): GeneratedFile[] {
  const packageManager = options.packageManager ?? 'yarn';
  const files: GeneratedFile[] = [];

  for (const [name, profile] of Object.entries(config.build)) {
    const platforms = platformsFor(profile.platform);
    const jobs = platforms.map((platform) => ({
      id: `build-${platform}`,
      name: `Build ${name} (${platform})`,
      platform,
      lane: name,
      runsOn: platform === 'ios' ? 'macos-latest' : 'ubuntu-latest',
      secrets: secretsFor(platform, profile.distribution),
    }));

    const content = renderTemplate('github/workflow.ejs', {
      workflowName: `rn-workflows • ${name}`,
      branch: branchFor(name),
      jobs,
      packageManager,
    });

    files.push({ path: `.github/workflows/rn-${name}.yml`, content });
  }

  return files;
}
```

- [ ] **Step 5: Update Fastfile template**

In `src/templates/fastlane/Fastfile.ejs`, find the two `yarn install` lines (lines 11 and 54):

Line 11:
```ejs
    sh("cd .. && yarn install --frozen-lockfile")
```

Replace both occurrences with:
```ejs
    sh("cd .. && <%= packageManager === 'bun' ? 'bun install --frozen-lockfile' : packageManager === 'npm' ? 'npm ci' : 'yarn install --frozen-lockfile' %>")
```

- [ ] **Step 6: Update workflow template**

In `src/templates/github/workflow.ejs`, find the Setup Node block (around line 20):

```ejs
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: yarn
```

Replace with:

```ejs
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: <%= packageManager %>
```

Then find the `yarn install --frozen-lockfile` line (around line 42):

```ejs
      - name: Install JS dependencies
        run: yarn install --frozen-lockfile
```

Replace with:

```ejs
      - name: Install JS dependencies
        run: <%= packageManager === 'bun' ? 'bun install --frozen-lockfile' : packageManager === 'npm' ? 'npm ci' : 'yarn install --frozen-lockfile' %>
```

- [ ] **Step 7: Add package manager detection to generate.ts**

In `src/commands/generate.ts`, add this function before the `defineCommand` call:

```ts
function detectPackageManager(cwd: string): 'yarn' | 'npm' | 'bun' {
  if (existsSync(resolve(cwd, 'bun.lock')) || existsSync(resolve(cwd, 'bun.lockb'))) return 'bun';
  if (existsSync(resolve(cwd, 'yarn.lock'))) return 'yarn';
  if (existsSync(resolve(cwd, 'package-lock.json'))) return 'npm';
  return 'yarn';
}
```

Then in the `run` function, after `config` is resolved (around line 64), add:

```ts
const packageManager = detectPackageManager(String(args.cwd));
const options = { packageManager };

const files: GeneratedFile[] = [
  ...generateFastlane(config, options),
  ...(config.ci === 'github-actions'
    ? generateGithubActions(config, options)
    : generateGitlab(config)),
];
```

Note: `existsSync` and `resolve` are already imported at the top of the file.

- [ ] **Step 8: Run tests to verify they pass**

```bash
bun test tests/fastlane.test.ts tests/github-actions.test.ts
```

Expected: all tests pass except `output matches snapshot` (snapshot is stale — `cache: yarn` is now `cache: yarn` via template variable, which is the same value, so snapshot may not change. But verify).

- [ ] **Step 9: Update snapshot if needed**

```bash
bun test --update-snapshots
```

- [ ] **Step 10: Run full test suite**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/generators/fastlane.ts src/generators/github-actions.ts src/commands/generate.ts src/templates/fastlane/Fastfile.ejs src/templates/github/workflow.ejs tests/fastlane.test.ts tests/github-actions.test.ts tests/__snapshots__/github-actions.test.ts.snap
git commit -m "fix: auto-detect package manager from lock files and use correct install command"
```
