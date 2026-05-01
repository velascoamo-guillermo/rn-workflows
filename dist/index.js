#!/usr/bin/env node

// src/index.ts
import { defineCommand as defineCommand4, runMain } from "citty";
import { createRequire } from "node:module";

// src/commands/init.ts
import { defineCommand } from "citty";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as p from "@clack/prompts";
import yaml from "js-yaml";

// src/config/schema.ts
import { z } from "zod";
var PLATFORMS = ["android", "ios", "all"];
var DISTRIBUTIONS = [
  "firebase",
  "testflight",
  "appcenter",
  "github-releases",
  "store"
];
var CI_PROVIDERS = ["github-actions", "gitlab"];
var PROJECT_TYPES = ["expo", "bare"];
var PlatformSchema = z.enum(PLATFORMS);
var DistributionSchema = z.enum(DISTRIBUTIONS);
var CiSchema = z.enum(CI_PROVIDERS);
var ProjectTypeSchema = z.enum(PROJECT_TYPES);
var DistributionStringSchema = z.string().min(1, "distribution cannot be empty").superRefine((raw, ctx) => {
  const targets = raw.split("+").map((s) => s.trim());
  const unknown = targets.filter((t) => !DISTRIBUTIONS.includes(t));
  if (unknown.length > 0) {
    ctx.addIssue({
      code: "custom",
      message: `distribution "${raw}" has unknown targets (${unknown.join(", ")}). Valid: ${DISTRIBUTIONS.join(", ")}. Combine with "+".`
    });
  }
});
var AndroidBuildOptionsSchema = z.object({
  buildType: z.enum(["apk", "aab"]).optional()
});
var IosBuildOptionsSchema = z.object({
  exportMethod: z.enum(["app-store", "ad-hoc", "development"]).optional()
});
var BuildProfileSchema = z.object({
  platform: PlatformSchema,
  distribution: DistributionStringSchema,
  android: AndroidBuildOptionsSchema.optional(),
  ios: IosBuildOptionsSchema.optional()
});
var ProjectSchema = z.object({
  type: ProjectTypeSchema,
  bundleId: z.string().min(1),
  packageName: z.string().min(1)
});
var ConfigSchema = z.object({
  project: ProjectSchema,
  ci: CiSchema,
  build: z.record(z.string().min(1), BuildProfileSchema)
}).superRefine((cfg, ctx) => {
  const profiles = Object.entries(cfg.build);
  if (profiles.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["build"],
      message: "at least one build profile is required"
    });
  }
  for (const [name, profile] of profiles) {
    const targets = profile.distribution.split("+").map((s) => s.trim());
    const touchesIos = profile.platform === "ios" || profile.platform === "all";
    const touchesAndroid = profile.platform === "android" || profile.platform === "all";
    if (targets.includes("store") && touchesAndroid) {
      const buildType = profile.android?.buildType ?? "aab";
      if (buildType !== "aab") {
        ctx.addIssue({
          code: "custom",
          path: ["build", name, "android", "buildType"],
          message: 'Play Store upload requires buildType "aab"'
        });
      }
    }
    if (targets.includes("testflight") && !touchesIos) {
      ctx.addIssue({
        code: "custom",
        path: ["build", name, "platform"],
        message: 'distribution "testflight" requires platform "ios" or "all"'
      });
    }
  }
});

// src/commands/init.ts
var init_default = defineCommand({
  meta: {
    name: "init",
    description: "Interactively create rn-workflows.yml"
  },
  args: {
    force: {
      type: "boolean",
      description: "Overwrite existing rn-workflows.yml",
      default: false
    },
    cwd: {
      type: "string",
      description: "Directory to create rn-workflows.yml in",
      default: process.cwd()
    }
  },
  async run({ args }) {
    p.intro("rn-workflows init");
    const outPath = resolve(String(args.cwd), "rn-workflows.yml");
    if (existsSync(outPath) && !args.force) {
      p.log.error(`${outPath} already exists. Pass --force to overwrite.`);
      process.exit(1);
    }
    const projectType = await p.select({
      message: "Project type",
      options: PROJECT_TYPES.map((t) => ({ value: t, label: t })),
      initialValue: "expo"
    });
    assertNotCancelled(projectType);
    const bundleId = await p.text({
      message: "iOS bundle identifier (e.g. com.myapp)",
      placeholder: "com.myapp",
      validate: (v) => v && v.includes(".") ? undefined : "Must look like com.myapp"
    });
    assertNotCancelled(bundleId);
    const packageName = await p.text({
      message: "Android package name",
      placeholder: bundleId,
      defaultValue: bundleId
    });
    assertNotCancelled(packageName);
    const ci = await p.select({
      message: "CI provider",
      options: CI_PROVIDERS.map((c) => ({ value: c, label: c })),
      initialValue: "github-actions"
    });
    assertNotCancelled(ci);
    const profiles = await p.multiselect({
      message: "Build profiles to generate",
      options: [
        { value: "preview", label: "preview (android-only, firebase)" },
        { value: "staging", label: "staging (android+ios, ad-hoc)" },
        { value: "production", label: "production (android+ios, store)" }
      ],
      initialValues: ["preview", "production"],
      required: true
    });
    assertNotCancelled(profiles);
    const distributions = await p.multiselect({
      message: "Distributions to support (affects preview/staging only)",
      options: DISTRIBUTIONS.filter((d) => d !== "store").map((d) => ({ value: d, label: d })),
      initialValues: ["firebase"],
      required: true
    });
    assertNotCancelled(distributions);
    const build = {};
    const previewDist = distributions.join("+");
    if (profiles.includes("preview")) {
      build.preview = {
        platform: "android",
        distribution: previewDist,
        android: { buildType: "apk" }
      };
    }
    if (profiles.includes("staging")) {
      build.staging = {
        platform: "all",
        distribution: previewDist,
        android: { buildType: "apk" },
        ios: { exportMethod: "ad-hoc" }
      };
    }
    if (profiles.includes("production")) {
      build.production = {
        platform: "all",
        distribution: "store",
        android: { buildType: "aab" },
        ios: { exportMethod: "app-store" }
      };
    }
    const config = {
      project: { type: projectType, bundleId, packageName },
      ci,
      build
    };
    const header = "# rn-workflows config. Run `npx rn-workflows generate` after editing.\n";
    writeFileSync(outPath, header + yaml.dump(config, { noRefs: true, lineWidth: 120 }));
    p.outro(`Wrote ${outPath}`);
  }
});
function assertNotCancelled(value) {
  if (typeof value === "symbol") {
    p.cancel("Cancelled.");
    process.exit(0);
  }
}

// src/commands/generate.ts
import { defineCommand as defineCommand2 } from "citty";
import { resolve as resolve2 } from "node:path";
import { existsSync as existsSync2 } from "node:fs";
import * as p2 from "@clack/prompts";

// src/config/parser.ts
import { readFileSync } from "node:fs";
import yaml2 from "js-yaml";
import { ZodError } from "zod";
class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}
function parseConfig(raw) {
  let data;
  try {
    data = yaml2.load(raw);
  } catch (err) {
    throw new ConfigError(`YAML parse error: ${err.message}`);
  }
  try {
    return ConfigSchema.parse(data);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new ConfigError(formatZodError(err));
    }
    throw err;
  }
}
function loadConfig(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new ConfigError(`Cannot read config at ${path}: ${err.message}`);
  }
  return parseConfig(raw);
}
function formatZodError(err) {
  const lines = err.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "<root>";
    return `  - ${path}: ${issue.message}`;
  });
  return `Invalid rn-workflows.yml:
${lines.join(`
`)}`;
}

// src/utils/render.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
var here = dirname(fileURLToPath(import.meta.url));
function resolveTemplate(relPath) {
  const candidates = [
    join(here, "..", "templates", relPath),
    join(here, "..", "src", "templates", relPath),
    join(here, "..", "..", "src", "templates", relPath)
  ];
  for (const p2 of candidates) {
    try {
      return readFileSync2(p2, "utf8");
    } catch {}
  }
  throw new Error(`Template not found: ${relPath}`);
}
function renderTemplate(relPath, data) {
  const tpl = resolveTemplate(relPath);
  return ejs.render(tpl, data, { rmWhitespace: false });
}

// src/generators/fastlane.ts
function toAndroidView(name, profile) {
  const isAab = profile.android?.buildType === "aab";
  const targets = profile.distribution.split("+").map((s) => s.trim());
  const artifactPath = isAab ? "android/app/build/outputs/bundle/release/app-release.aab" : "android/app/build/outputs/apk/release/app-release.apk";
  return {
    name,
    description: `Build ${name} (android)`,
    targets,
    gradleTask: isAab ? "bundle" : "assemble",
    isAab,
    androidArtifactPath: artifactPath
  };
}
function toIosView(name, profile, bundleId) {
  const exportMethod = profile.ios?.exportMethod ?? "app-store";
  const targets = profile.distribution.split("+").map((s) => s.trim());
  const matchType = exportMethod === "app-store" ? "appstore" : exportMethod === "ad-hoc" ? "adhoc" : "development";
  const schemeName = bundleId.split(".").pop() ?? "App";
  return {
    name,
    description: `Build ${name} (ios)`,
    targets,
    exportMethod,
    matchType,
    xcWorkspace: schemeName,
    xcScheme: schemeName
  };
}
function generateFastlane(config, options = {}) {
  const packageManager = options.packageManager ?? "yarn";
  const androidProfiles = [];
  const iosProfiles = [];
  for (const [name, profile] of Object.entries(config.build)) {
    if (profile.platform === "android" || profile.platform === "all") {
      androidProfiles.push(toAndroidView(name, profile));
    }
    if (profile.platform === "ios" || profile.platform === "all") {
      iosProfiles.push(toIosView(name, profile, config.project.bundleId));
    }
  }
  const allTargets = new Set(Object.values(config.build).flatMap((p2) => p2.distribution.split("+").map((s) => s.trim())));
  const fastfile = renderTemplate("fastlane/Fastfile.ejs", {
    androidProfiles,
    iosProfiles,
    projectType: config.project.type,
    bundleId: config.project.bundleId,
    packageName: config.project.packageName,
    packageManager,
    usesFirebase: allTargets.has("firebase"),
    hasIos: iosProfiles.length > 0,
    hasAndroidFirebase: androidProfiles.some((p2) => p2.targets.includes("firebase")),
    hasIosFirebase: iosProfiles.some((p2) => p2.targets.includes("firebase"))
  });
  const appfile = renderTemplate("fastlane/Appfile.ejs", {
    bundleId: config.project.bundleId,
    packageName: config.project.packageName
  });
  const gemfile = renderTemplate("fastlane/Gemfile.ejs", {});
  const pluginfile = renderTemplate("fastlane/Pluginfile.ejs", {
    usesFirebase: allTargets.has("firebase"),
    usesAppCenter: allTargets.has("appcenter")
  });
  return [
    { path: "fastlane/Fastfile", content: fastfile },
    { path: "fastlane/Appfile", content: appfile },
    { path: "fastlane/Pluginfile", content: pluginfile },
    { path: "Gemfile", content: gemfile }
  ];
}

// src/secrets.ts
var ANDROID_SECRETS = {
  firebase: ["FIREBASE_APP_ID_ANDROID", "FIREBASE_SERVICE_ACCOUNT_JSON"],
  testflight: [],
  appcenter: ["APPCENTER_API_TOKEN", "APPCENTER_OWNER_NAME", "APPCENTER_APP_NAME_ANDROID"],
  "github-releases": ["GITHUB_TOKEN"],
  store: ["PLAY_STORE_JSON_KEY"]
};
var IOS_SECRETS = {
  firebase: ["FIREBASE_APP_ID_IOS", "FIREBASE_SERVICE_ACCOUNT_JSON"],
  testflight: ["APP_STORE_CONNECT_API_KEY_PATH", "APPLE_TEAM_ID"],
  appcenter: ["APPCENTER_API_TOKEN", "APPCENTER_OWNER_NAME", "APPCENTER_APP_NAME_IOS"],
  "github-releases": ["GITHUB_TOKEN"],
  store: ["APP_STORE_CONNECT_API_KEY_PATH", "APPLE_TEAM_ID"]
};
var IOS_SIGNING_SECRETS = ["MATCH_PASSWORD", "MATCH_GIT_URL"];
function secretsFor(platform, distributionRaw) {
  const targets = distributionRaw.split("+").map((s) => s.trim());
  const map = platform === "android" ? ANDROID_SECRETS : IOS_SECRETS;
  const set = new Set;
  for (const target of targets) {
    for (const secret of map[target] ?? [])
      set.add(secret);
  }
  if (platform === "ios") {
    for (const s of IOS_SIGNING_SECRETS)
      set.add(s);
  }
  return [...set].sort();
}
function platformsFor(platform) {
  if (platform === "all")
    return ["android", "ios"];
  return [platform];
}

// src/generators/github-actions.ts
var DEFAULT_BRANCH = {
  preview: "develop",
  staging: "staging",
  production: "main"
};
function branchFor(profileName) {
  return DEFAULT_BRANCH[profileName] ?? "main";
}
function generateGithubActions(config, options = {}) {
  const packageManager = options.packageManager ?? "yarn";
  const files = [];
  for (const [name, profile] of Object.entries(config.build)) {
    const platforms = platformsFor(profile.platform);
    const jobs = platforms.map((platform) => ({
      id: `build-${platform}`,
      name: `Build ${name} (${platform})`,
      platform,
      lane: name,
      runsOn: platform === "ios" ? "macos-latest" : "ubuntu-latest",
      secrets: secretsFor(platform, profile.distribution)
    }));
    const content = renderTemplate("github/workflow.ejs", {
      workflowName: `rn-workflows • ${name}`,
      branch: branchFor(name),
      jobs,
      packageManager
    });
    files.push({ path: `.github/workflows/rn-${name}.yml`, content });
  }
  return files;
}

// src/generators/gitlab.ts
var DEFAULT_BRANCH2 = {
  preview: "develop",
  staging: "staging",
  production: "main"
};
var ANDROID_IMAGE = "reactnativecommunity/react-native-android:latest";
var IOS_IMAGE = "macos-14-xcode-15";
function generateGitlab(config) {
  const jobs = [];
  for (const [name, profile] of Object.entries(config.build)) {
    const platforms = platformsFor(profile.platform);
    const branch = DEFAULT_BRANCH2[name] ?? "main";
    for (const platform of platforms) {
      jobs.push({
        id: `build:${name}:${platform}`,
        platform,
        lane: name,
        image: platform === "android" ? ANDROID_IMAGE : IOS_IMAGE,
        branch,
        secrets: secretsFor(platform, profile.distribution)
      });
    }
  }
  const content = renderTemplate("gitlab/gitlab-ci.ejs", { jobs });
  return [{ path: ".gitlab-ci.yml", content }];
}

// src/utils/fs.ts
import { mkdirSync, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname as dirname2 } from "node:path";
function writeFileEnsured(path, content) {
  mkdirSync(dirname2(path), { recursive: true });
  writeFileSync2(path, content, "utf8");
}

// src/commands/generate.ts
function detectPackageManager(cwd) {
  if (existsSync2(resolve2(cwd, "bun.lock")) || existsSync2(resolve2(cwd, "bun.lockb")))
    return "bun";
  if (existsSync2(resolve2(cwd, "yarn.lock")))
    return "yarn";
  if (existsSync2(resolve2(cwd, "package-lock.json")))
    return "npm";
  return "yarn";
}
var generate_default = defineCommand2({
  meta: {
    name: "generate",
    description: "Generate Fastlane + CI files from rn-workflows.yml"
  },
  args: {
    config: {
      type: "string",
      description: "Path to rn-workflows.yml",
      default: "rn-workflows.yml"
    },
    ci: {
      type: "string",
      description: `Override CI provider. Valid: ${CI_PROVIDERS.join(", ")}`
    },
    "dry-run": {
      type: "boolean",
      description: "Print what would be written without touching the filesystem",
      default: false
    },
    cwd: {
      type: "string",
      description: "Working directory to write output into",
      default: process.cwd()
    }
  },
  async run({ args }) {
    const configPath = resolve2(String(args.cwd), String(args.config));
    if (!existsSync2(configPath)) {
      p2.log.error(`Config not found: ${configPath}`);
      p2.log.info("Run `rn-workflows init` to create one.");
      process.exit(1);
    }
    let config;
    try {
      config = loadConfig(configPath);
    } catch (err) {
      if (err instanceof ConfigError) {
        p2.log.error(err.message);
        process.exit(1);
      }
      throw err;
    }
    if (args.ci) {
      if (!CI_PROVIDERS.includes(String(args.ci))) {
        p2.log.error(`Invalid --ci value. Valid: ${CI_PROVIDERS.join(", ")}`);
        process.exit(1);
      }
      config = { ...config, ci: args.ci };
    }
    const packageManager = detectPackageManager(String(args.cwd));
    const options = { packageManager };
    const files = [
      ...generateFastlane(config, options),
      ...config.ci === "github-actions" ? generateGithubActions(config, options) : generateGitlab(config)
    ];
    const outDir = String(args.cwd);
    const dryRun = Boolean(args["dry-run"]);
    p2.log.info(`${dryRun ? "[dry-run] " : ""}Generating ${files.length} file(s) in ${outDir}`);
    for (const file of files) {
      const abs = resolve2(outDir, file.path);
      if (dryRun) {
        p2.log.step(`would write ${file.path} (${file.content.length} bytes)`);
      } else {
        writeFileEnsured(abs, file.content);
        p2.log.step(`wrote ${file.path}`);
      }
    }
    p2.outro(dryRun ? "Dry run complete." : "Done.");
  }
});

// src/commands/setup.ts
import { defineCommand as defineCommand3 } from "citty";
import { resolve as resolve3 } from "node:path";
import { existsSync as existsSync5 } from "node:fs";
import * as p5 from "@clack/prompts";

// src/setup/runner.ts
import * as p3 from "@clack/prompts";
async function runSteps(steps, ctx) {
  for (const step of steps) {
    if (ctx.dryRun) {
      p3.log.step(`[dry-run] ${step.label}`);
      continue;
    }
    let result;
    try {
      result = await step.run(ctx);
    } catch (err) {
      p3.log.error(`[${step.id}] ${step.label}: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
    if (result.skipped) {
      p3.log.step(`↩ skipped: ${step.label}${result.note ? ` (${result.note})` : ""}`);
    } else {
      p3.log.step(`✓ ${step.label}${result.note ? ` — ${result.note}` : ""}`);
    }
  }
}

// src/setup/firebase.ts
import { tmpdir } from "node:os";
import { join as join2 } from "node:path";
import { unlinkSync, readFileSync as readFileSync3 } from "node:fs";

// src/setup/shell.ts
import { spawnSync } from "node:child_process";
function shell(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1
  };
}
function isAvailable(cmd) {
  const result = spawnSync("which", [cmd], { encoding: "utf8" });
  return result.status === 0;
}

// src/setup/prompts.ts
import * as p4 from "@clack/prompts";
async function promptText(message, options) {
  const val = await p4.text({ message, ...options, validate: (v) => v?.trim() ? undefined : "Required" });
  if (typeof val === "symbol") {
    p4.cancel("Cancelled.");
    process.exit(0);
  }
  return val;
}

// src/setup/firebase.ts
function makeFirebaseAppsStep() {
  return {
    id: "firebase-apps",
    label: "Create Firebase apps",
    async run(ctx) {
      const { bundleId, packageName } = ctx.config.project;
      const projectId = ctx.firebaseProjectId;
      const usesFirebase = Object.values(ctx.config.build).some((pr) => pr.distribution.includes("firebase"));
      if (!usesFirebase) {
        return { skipped: true, note: "no firebase distribution" };
      }
      const needsAndroid = Object.values(ctx.config.build).some((pr) => pr.distribution.includes("firebase") && (pr.platform === "android" || pr.platform === "all"));
      const needsIos = Object.values(ctx.config.build).some((pr) => pr.distribution.includes("firebase") && (pr.platform === "ios" || pr.platform === "all"));
      if (!isAvailable("firebase")) {
        if (needsAndroid) {
          ctx.collectedSecrets["FIREBASE_APP_ID_ANDROID"] = await promptText("Firebase App ID (Android)");
        }
        if (needsIos) {
          ctx.collectedSecrets["FIREBASE_APP_ID_IOS"] = await promptText("Firebase App ID (iOS)");
        }
        return { skipped: false, note: "entered manually (firebase CLI not found)" };
      }
      const listResult = shell("firebase", ["apps:list", "--project", projectId, "--json"]);
      const apps = JSON.parse(listResult.stdout || "[]").result ?? [];
      const hasAndroid = apps.some((a) => a.platform === "ANDROID" && a.namespace === packageName);
      const hasIos = apps.some((a) => a.platform === "IOS" && a.namespace === bundleId);
      if (needsAndroid && !hasAndroid) {
        const r = shell("firebase", ["apps:create", "ANDROID", "--package-name", packageName, "--project", projectId]);
        if (r.exitCode !== 0)
          throw new Error(`Failed to create Android app: ${r.stderr}`);
      }
      if (needsIos && !hasIos) {
        const r = shell("firebase", ["apps:create", "IOS", "--bundle-id", bundleId, "--project", projectId]);
        if (r.exitCode !== 0)
          throw new Error(`Failed to create iOS app: ${r.stderr}`);
      }
      const updated = shell("firebase", ["apps:list", "--project", projectId, "--json"]);
      const updatedApps = JSON.parse(updated.stdout || "[]").result ?? [];
      if (needsAndroid) {
        const androidApp = updatedApps.find((a) => a.platform === "ANDROID" && a.namespace === packageName);
        if (androidApp)
          ctx.collectedSecrets["FIREBASE_APP_ID_ANDROID"] = androidApp.appId;
      }
      if (needsIos) {
        const iosApp = updatedApps.find((a) => a.platform === "IOS" && a.namespace === bundleId);
        if (iosApp)
          ctx.collectedSecrets["FIREBASE_APP_ID_IOS"] = iosApp.appId;
      }
      return {
        skipped: (!needsAndroid || hasAndroid) && (!needsIos || hasIos),
        note: (!needsAndroid || hasAndroid) && (!needsIos || hasIos) ? "already existed" : "created"
      };
    }
  };
}
function makeServiceAccountStep() {
  return {
    id: "service-account",
    label: "Generate Firebase service account",
    async run(ctx) {
      const usesFirebase = Object.values(ctx.config.build).some((pr) => pr.distribution.includes("firebase"));
      if (!usesFirebase) {
        return { skipped: true, note: "no firebase distribution" };
      }
      if (ctx.collectedSecrets["FIREBASE_SERVICE_ACCOUNT_JSON"]) {
        return { skipped: true, note: "already collected" };
      }
      if (!isAvailable("gcloud")) {
        const json2 = await promptText("Paste Firebase service account JSON");
        ctx.collectedSecrets["FIREBASE_SERVICE_ACCOUNT_JSON"] = json2;
        return { skipped: false, note: "entered manually (gcloud not found)" };
      }
      const projectId = ctx.firebaseProjectId;
      const saResult = shell("gcloud", [
        "iam",
        "service-accounts",
        "list",
        `--project=${projectId}`,
        "--format=value(email)",
        "--filter=displayName~firebase-adminsdk"
      ]);
      const saEmail = saResult.stdout.trim().split(`
`).find((e) => e.includes("firebase-adminsdk"));
      if (!saEmail)
        throw new Error("firebase-adminsdk service account not found. Enable Firebase in your project.");
      const tmpPath = join2(tmpdir(), `rn-workflows-sa-${Date.now()}.json`);
      const r = shell("gcloud", [
        "iam",
        "service-accounts",
        "keys",
        "create",
        tmpPath,
        `--iam-account=${saEmail}`,
        `--project=${projectId}`
      ]);
      if (r.exitCode !== 0)
        throw new Error(`gcloud key create failed: ${r.stderr}`);
      let json;
      try {
        json = readFileSync3(tmpPath, "utf8");
      } finally {
        try {
          unlinkSync(tmpPath);
        } catch {}
      }
      ctx.collectedSecrets["FIREBASE_SERVICE_ACCOUNT_JSON"] = json;
      return { skipped: false, note: "key created and collected" };
    }
  };
}

// src/setup/match.ts
function makeMatchRepoStep() {
  return {
    id: "match-repo",
    label: "Create match certificates repo",
    async run(ctx) {
      const hasIos = Object.values(ctx.config.build).some((p5) => p5.platform === "ios" || p5.platform === "all");
      if (!hasIos)
        return { skipped: true, note: "no iOS builds" };
      const repoName = ctx.matchRepoName;
      if (ctx.config.ci === "github-actions") {
        if (!isAvailable("gh"))
          throw new Error("gh CLI not found. Install from https://cli.github.com");
        const check = shell("gh", ["repo", "view", repoName]);
        if (check.exitCode === 0) {
          const owner = repoName.includes("/") ? repoName.split("/")[0] : ctx.githubRepo.split("/")[0];
          const fullName2 = repoName.includes("/") ? repoName : `${owner}/${repoName}`;
          ctx.collectedSecrets["MATCH_GIT_URL"] = `https://github.com/${fullName2}.git`;
          return { skipped: true, note: "repo already exists" };
        }
        const fullName = repoName.includes("/") ? repoName : `${ctx.githubRepo.split("/")[0]}/${repoName}`;
        const r = shell("gh", ["repo", "create", fullName, "--private", "--description", "Fastlane Match certificates"]);
        if (r.exitCode !== 0)
          throw new Error(`gh repo create failed: ${r.stderr}`);
        ctx.collectedSecrets["MATCH_GIT_URL"] = `https://github.com/${fullName}.git`;
        return { skipped: false, note: fullName };
      }
      if (ctx.config.ci === "gitlab") {
        const checkUrl = `https://gitlab.com/api/v4/projects/${encodeURIComponent(repoName)}`;
        const checkRes = await fetch(checkUrl, {
          headers: { "PRIVATE-TOKEN": ctx.gitlabToken }
        });
        if (checkRes.ok) {
          const existing = await checkRes.json();
          ctx.collectedSecrets["MATCH_GIT_URL"] = existing.http_url_to_repo;
          return { skipped: true, note: "repo already exists" };
        }
        const res = await fetch("https://gitlab.com/api/v4/projects", {
          method: "POST",
          headers: { "PRIVATE-TOKEN": ctx.gitlabToken, "Content-Type": "application/json" },
          body: JSON.stringify({ name: repoName, visibility: "private" })
        });
        if (!res.ok)
          throw new Error(`GitLab project create failed: ${await res.text()}`);
        const data = await res.json();
        ctx.collectedSecrets["MATCH_GIT_URL"] = data.http_url_to_repo;
        return { skipped: false, note: repoName };
      }
      throw new Error(`Unsupported CI: ${ctx.config.ci}`);
    }
  };
}

// src/setup/secrets.ts
function collectRequiredSecrets(config) {
  const set = new Set;
  for (const profile of Object.values(config.build)) {
    for (const platform of platformsFor(profile.platform)) {
      for (const s of secretsFor(platform, profile.distribution)) {
        set.add(s);
      }
    }
  }
  return [...set].sort();
}
function makeSecretsStep() {
  return {
    id: "secrets",
    label: "Upload CI secrets",
    async run(ctx) {
      const required = collectRequiredSecrets(ctx.config);
      const missing = required.filter((k) => !ctx.collectedSecrets[k]);
      if (missing.length > 0) {
        throw new Error(`Missing values for secrets: ${missing.join(", ")}`);
      }
      if (ctx.config.ci === "github-actions") {
        if (!isAvailable("gh")) {
          throw new Error("gh CLI not found. Install from https://cli.github.com");
        }
        const existing = getExistingGithubSecrets(ctx.githubRepo);
        let uploaded = 0;
        for (const [key, value] of Object.entries(ctx.collectedSecrets)) {
          if (existing.has(key))
            continue;
          const result = shell("gh", ["secret", "set", key, "--body", value, "--repo", ctx.githubRepo]);
          if (result.exitCode !== 0)
            throw new Error(`gh secret set ${key} failed: ${result.stderr}`);
          uploaded++;
        }
        return { skipped: uploaded === 0, note: uploaded > 0 ? `${uploaded} secrets uploaded` : "all already set" };
      }
      if (ctx.config.ci === "gitlab") {
        let uploaded = 0;
        for (const [key, value] of Object.entries(ctx.collectedSecrets)) {
          const res = await setGitlabVariable(ctx.gitlabProjectId, ctx.gitlabToken, key, value);
          if (res)
            uploaded++;
        }
        return { skipped: uploaded === 0, note: `${uploaded} secrets uploaded` };
      }
      throw new Error(`Unsupported CI: ${ctx.config.ci}`);
    }
  };
}
function getExistingGithubSecrets(repo) {
  const result = shell("gh", ["secret", "list", "--repo", repo, "--json", "name", "--jq", ".[].name"]);
  if (result.exitCode !== 0)
    return new Set;
  return new Set(result.stdout.trim().split(`
`).filter(Boolean));
}
async function setGitlabVariable(projectId, token, key, value) {
  const url = `https://gitlab.com/api/v4/projects/${encodeURIComponent(projectId)}/variables`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "PRIVATE-TOKEN": token, "Content-Type": "application/json" },
    body: JSON.stringify({ key, value, protected: false, masked: false })
  });
  return res.ok;
}

// src/setup/appcenter.ts
function makeAppCenterStep() {
  return {
    id: "appcenter",
    label: "Configure AppCenter",
    async run(ctx) {
      const usesAppCenter = Object.values(ctx.config.build).some((pr) => pr.distribution.includes("appcenter"));
      if (!usesAppCenter)
        return { skipped: true, note: "not used" };
      if (ctx.collectedSecrets["APPCENTER_API_TOKEN"]) {
        return { skipped: true, note: "already collected" };
      }
      const token = await promptText("AppCenter API token");
      const owner = await promptText("AppCenter owner name");
      const hasAndroid = Object.values(ctx.config.build).some((pr) => pr.distribution.includes("appcenter") && (pr.platform === "android" || pr.platform === "all"));
      const hasIos = Object.values(ctx.config.build).some((pr) => pr.distribution.includes("appcenter") && (pr.platform === "ios" || pr.platform === "all"));
      ctx.collectedSecrets["APPCENTER_API_TOKEN"] = token;
      ctx.collectedSecrets["APPCENTER_OWNER_NAME"] = owner;
      if (hasAndroid)
        ctx.collectedSecrets["APPCENTER_APP_NAME_ANDROID"] = await promptText("AppCenter Android app name");
      if (hasIos)
        ctx.collectedSecrets["APPCENTER_APP_NAME_IOS"] = await promptText("AppCenter iOS app name");
      return { skipped: false };
    }
  };
}

// src/setup/appstore.ts
import { existsSync as existsSync3, readFileSync as readFileSync4 } from "node:fs";
function makeAppStoreStep() {
  return {
    id: "appstore",
    label: "Configure App Store Connect",
    async run(ctx) {
      const needsAppStore = Object.values(ctx.config.build).some((pr) => {
        const dists = pr.distribution.split("+");
        const hasIos = pr.platform === "ios" || pr.platform === "all";
        return hasIos && (dists.includes("store") || dists.includes("testflight"));
      });
      if (!needsAppStore)
        return { skipped: true, note: "not used" };
      if (ctx.collectedSecrets["APPLE_TEAM_ID"]) {
        return { skipped: true, note: "already collected" };
      }
      const teamId = await promptText("Apple Team ID (e.g. ABCD1234)");
      ctx.collectedSecrets["APPLE_TEAM_ID"] = teamId;
      const keyPath = await promptText("Path to App Store Connect API key JSON");
      if (!existsSync3(keyPath))
        throw new Error(`File not found: ${keyPath}`);
      ctx.collectedSecrets["APP_STORE_CONNECT_API_KEY_PATH"] = readFileSync4(keyPath, "utf8");
      return { skipped: false };
    }
  };
}

// src/setup/playstore.ts
import { existsSync as existsSync4, readFileSync as readFileSync5 } from "node:fs";
function makePlayStoreStep() {
  return {
    id: "playstore",
    label: "Configure Play Store",
    async run(ctx) {
      const needsPlayStore = Object.values(ctx.config.build).some((pr) => {
        const dists = pr.distribution.split("+");
        const hasAndroid = pr.platform === "android" || pr.platform === "all";
        return hasAndroid && dists.includes("store");
      });
      if (!needsPlayStore)
        return { skipped: true, note: "not used" };
      if (ctx.collectedSecrets["PLAY_STORE_JSON_KEY"]) {
        return { skipped: true, note: "already collected" };
      }
      const keyPath = await promptText("Path to Play Store JSON key file");
      if (!existsSync4(keyPath))
        throw new Error(`File not found: ${keyPath}`);
      ctx.collectedSecrets["PLAY_STORE_JSON_KEY"] = readFileSync5(keyPath, "utf8");
      return { skipped: false };
    }
  };
}

// src/commands/setup.ts
var setup_default = defineCommand3({
  meta: {
    name: "setup",
    description: "Provision Firebase apps, match repo and CI secrets from rn-workflows.yml"
  },
  args: {
    cwd: { type: "string", description: "Working directory", default: process.cwd() },
    config: { type: "string", description: "Path to rn-workflows.yml", default: "rn-workflows.yml" },
    "firebase-project": { type: "string", description: "Firebase project ID" },
    "github-repo": { type: "string", description: "GitHub owner/repo for secrets" },
    "match-repo-name": { type: "string", description: "Name for match certificates repo" },
    "dry-run": { type: "boolean", description: "Print steps without executing", default: false }
  },
  async run({ args }) {
    p5.intro("rn-workflows setup");
    const configPath = resolve3(String(args.cwd), String(args.config));
    if (!existsSync5(configPath)) {
      p5.log.error(`Config not found: ${configPath}`);
      p5.log.info("Run `rn-workflows init` first.");
      process.exit(1);
    }
    let config;
    try {
      config = loadConfig(configPath);
    } catch (err) {
      if (err instanceof ConfigError) {
        p5.log.error(err.message);
        process.exit(1);
      }
      throw err;
    }
    const ctx = {
      config,
      dryRun: Boolean(args["dry-run"]),
      collectedSecrets: {}
    };
    if (config.ci === "github-actions") {
      if (args["github-repo"]) {
        ctx.githubRepo = String(args["github-repo"]);
      } else {
        const raw = await p5.text({
          message: "GitHub repo (owner/repo)",
          validate: (v) => v && v.includes("/") ? undefined : "Format: owner/repo"
        });
        assertNotCancelled2(raw);
        ctx.githubRepo = String(raw);
      }
    }
    if (config.ci === "gitlab") {
      const rawProjectId = await p5.text({ message: "GitLab project ID or path", validate: (v) => v?.trim() ? undefined : "Required" });
      assertNotCancelled2(rawProjectId);
      ctx.gitlabProjectId = String(rawProjectId);
      const rawToken = await p5.text({ message: "GitLab personal access token", validate: (v) => v?.trim() ? undefined : "Required" });
      assertNotCancelled2(rawToken);
      ctx.gitlabToken = String(rawToken);
    }
    const usesFirebase = Object.values(config.build).some((pr) => pr.distribution.includes("firebase"));
    if (usesFirebase) {
      if (args["firebase-project"]) {
        ctx.firebaseProjectId = String(args["firebase-project"]);
      } else {
        ctx.firebaseProjectId = await detectOrPromptFirebaseProject();
      }
    }
    const hasIos = Object.values(config.build).some((pr) => pr.platform === "ios" || pr.platform === "all");
    if (hasIos) {
      const defaultName = `${config.project.bundleId.split(".").pop()}-match`;
      if (args["match-repo-name"]) {
        ctx.matchRepoName = String(args["match-repo-name"]);
      } else {
        const rawMatchRepo = await p5.text({
          message: "Match repo name",
          placeholder: defaultName,
          defaultValue: defaultName
        });
        assertNotCancelled2(rawMatchRepo);
        ctx.matchRepoName = String(rawMatchRepo);
      }
      const rawPw = await p5.password({ message: "Match encryption password (MATCH_PASSWORD)" });
      assertNotCancelled2(rawPw);
      ctx.collectedSecrets["MATCH_PASSWORD"] = String(rawPw);
    }
    const usesGithubReleases = Object.values(config.build).some((pr) => pr.distribution.includes("github-releases"));
    if (usesGithubReleases) {
      const token = await promptText("GitHub token for releases (GITHUB_TOKEN)");
      ctx.collectedSecrets["GITHUB_TOKEN"] = token;
    }
    await runSteps([
      makeFirebaseAppsStep(),
      makeServiceAccountStep(),
      makeMatchRepoStep(),
      makeAppCenterStep(),
      makeAppStoreStep(),
      makePlayStoreStep(),
      makeSecretsStep()
    ], ctx);
    p5.log.success("Setup complete!");
    if (hasIos) {
      p5.log.warn("Next: seed match certificates manually:");
      p5.log.info("  MATCH_READONLY=false bundle exec fastlane match adhoc");
    }
    p5.outro("Done.");
  }
});
async function detectOrPromptFirebaseProject() {
  if (isAvailable("firebase")) {
    const result = shell("firebase", ["projects:list", "--json"]);
    if (result.exitCode === 0) {
      const projects = JSON.parse(result.stdout || "[]").result ?? [];
      if (projects.length === 1)
        return projects[0].projectId;
      if (projects.length > 1) {
        const chosen = await p5.select({
          message: "Select Firebase project",
          options: projects.map((pr) => ({ value: pr.projectId, label: `${pr.displayName} (${pr.projectId})` }))
        });
        if (typeof chosen === "symbol") {
          p5.cancel("Cancelled.");
          process.exit(0);
        }
        return String(chosen);
      }
    }
  }
  return await promptText("Firebase project ID");
}
function assertNotCancelled2(value) {
  if (typeof value === "symbol") {
    p5.cancel("Cancelled.");
    process.exit(0);
  }
}

// src/commands/menu.ts
import { existsSync as existsSync6 } from "node:fs";
import { resolve as resolve4 } from "node:path";
import * as p6 from "@clack/prompts";
import { spawnSync as spawnSync2 } from "node:child_process";
var MENU_CHOICES = [
  { value: "init", label: "Init project", hint: "Create rn-workflows.yml" },
  { value: "generate", label: "Generate files", hint: "Fastlane + CI from rn-workflows.yml" },
  { value: "setup", label: "Setup CI/CD", hint: "Firebase, Match, Secrets" },
  { value: "add_testers", label: "Add testers", hint: "Firebase App Distribution" },
  { value: "remove_testers", label: "Remove testers", hint: "Firebase App Distribution" },
  { value: "add_device", label: "Add device (iOS)", hint: "Register + regenerate match certs" },
  { value: "remove_device", label: "Remove device (iOS)", hint: "Disable device in Apple Developer" },
  { value: "view_profiles", label: "View profiles (iOS)", hint: "List provisioning profiles in match repo" },
  { value: "view_devices", label: "View devices (iOS)", hint: "List registered devices from Apple Developer" },
  { value: "exit", label: "Exit" }
];
var SETUP_CHOICES = [
  { value: "firebase", label: "Firebase", hint: "Create apps + service account" },
  { value: "match", label: "Match", hint: "Create certificates repo" },
  { value: "secrets", label: "Secrets", hint: "Upload to GitHub/GitLab" },
  { value: "all", label: "All", hint: "Run all setup steps" },
  { value: "back", label: "Back" }
];
async function runMenu(cwd = process.cwd()) {
  p6.intro("rn-workflows");
  while (true) {
    const choice = await p6.select({
      message: "What do you want to do?",
      options: MENU_CHOICES
    });
    if (typeof choice === "symbol" || choice === "exit") {
      p6.outro("Bye!");
      break;
    }
    if (choice === "init") {
      const initRun = init_default.run;
      if (initRun)
        await initRun({ args: { cwd, force: false }, rawArgs: [], cmd: init_default });
    } else if (choice === "generate") {
      const generateRun = generate_default.run;
      if (generateRun)
        await generateRun({ args: { cwd, config: "rn-workflows.yml", "dry-run": false }, rawArgs: [], cmd: generate_default });
    } else if (choice === "setup") {
      await handleSetupMenu(cwd);
    } else if (choice === "add_testers") {
      await handleAddTesters();
    } else if (choice === "remove_testers") {
      await handleRemoveTesters();
    } else if (choice === "add_device") {
      await handleAddDevice();
    } else if (choice === "remove_device") {
      await handleRemoveDevice();
    } else if (choice === "view_profiles") {
      await handleViewProfiles(cwd);
    } else if (choice === "view_devices") {
      await handleViewDevices();
    }
  }
}
async function handleSetupMenu(cwd) {
  const configPath = resolve4(cwd, "rn-workflows.yml");
  if (!existsSync6(configPath)) {
    p6.log.error("rn-workflows.yml not found. Run Init project first.");
    return;
  }
  let config;
  try {
    config = loadConfig(configPath);
  } catch (err) {
    if (err instanceof ConfigError) {
      p6.log.error(err.message);
      return;
    }
    throw err;
  }
  const choice = await p6.select({
    message: "Setup — what do you want to configure?",
    options: SETUP_CHOICES
  });
  if (typeof choice === "symbol" || choice === "back")
    return;
  const ctx = {
    config,
    dryRun: false,
    collectedSecrets: {}
  };
  const stepsMap = {
    firebase: [makeFirebaseAppsStep(), makeServiceAccountStep()],
    match: [makeMatchRepoStep()],
    secrets: [makeSecretsStep()],
    all: [makeFirebaseAppsStep(), makeServiceAccountStep(), makeMatchRepoStep(), makeSecretsStep()]
  };
  const selectedSteps = stepsMap[choice];
  if (!selectedSteps)
    return;
  try {
    await runSteps(selectedSteps, ctx);
    p6.log.success("Done!");
  } catch (err) {
    p6.log.error(err instanceof Error ? err.message : String(err));
  }
}
async function handleAddTesters() {
  const emails = await promptText("Tester emails (comma-separated)");
  const group = await promptText("Group alias", { defaultValue: "internal-testers", placeholder: "internal-testers" });
  p6.log.step("Running fastlane add_testers...");
  const result = spawnSync2("bundle", ["exec", "fastlane", "add_testers", `emails:${emails}`, `group:${group}`], { encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) {
    p6.log.error("add_testers failed. Make sure Fastlane is installed and credentials are set.");
  } else {
    p6.log.success("Testers added successfully.");
  }
}
async function handleAddDevice() {
  const name = await promptText("Device name");
  const udid = await promptText("Device UDID");
  p6.log.step("Running fastlane ios add_device...");
  const result = spawnSync2("bundle", ["exec", "fastlane", "ios", "add_device", `name:${name}`, `udid:${udid}`], { encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) {
    p6.log.error("add_device failed. Make sure Apple credentials are configured.");
  } else {
    p6.log.success("Device registered and match updated.");
  }
}
async function handleRemoveTesters() {
  const emails = await promptText("Tester emails to remove (comma-separated)");
  p6.log.step("Running fastlane remove_testers...");
  const result = spawnSync2("bundle", ["exec", "fastlane", "remove_testers", `emails:${emails}`], { encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) {
    p6.log.error("remove_testers failed.");
  } else {
    p6.log.success("Testers removed successfully.");
  }
}
async function handleRemoveDevice() {
  const udid = await promptText("Device UDID to disable");
  p6.log.step("Running fastlane ios remove_device...");
  const result = spawnSync2("bundle", ["exec", "fastlane", "ios", "remove_device", `udid:${udid}`], { encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) {
    p6.log.error("remove_device failed. Make sure Apple credentials are configured.");
  }
}
async function handleViewProfiles(cwd) {
  let matchGitUrl = process.env["MATCH_GIT_URL"];
  if (!matchGitUrl) {
    matchGitUrl = await promptText("Match repo URL (MATCH_GIT_URL)", { placeholder: "https://github.com/owner/match-repo.git" });
  }
  p6.log.step("Fetching profiles from match repo...");
  const matchResult = matchGitUrl.match(/github\.com[/:](.+?)(?:\.git)?$/);
  if (!matchResult) {
    p6.log.error(`Cannot parse GitHub repo from URL: ${matchGitUrl}`);
    return;
  }
  const repo = matchResult[1];
  const result = spawnSync2("gh", ["api", `repos/${repo}/contents/profiles`, "--jq", ".[].name"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) {
    p6.log.warn("No profiles found or gh CLI not authenticated.");
    return;
  }
  const types = result.stdout.trim().split(`
`);
  for (const type of types) {
    const profiles = spawnSync2("gh", ["api", `repos/${repo}/contents/profiles/${type}`, "--jq", ".[].name"], { encoding: "utf8" });
    if (profiles.stdout.trim()) {
      p6.log.info(`${type}:`);
      for (const prof of profiles.stdout.trim().split(`
`)) {
        p6.log.step(`  ${prof}`);
      }
    }
  }
  p6.log.success("Done.");
}
async function handleViewDevices() {
  p6.log.step("Fetching registered devices from Apple Developer...");
  const result = spawnSync2("bundle", ["exec", "fastlane", "ios", "list_devices"], { encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) {
    p6.log.error("Failed. Make sure APPLE_ID is set and Fastlane is installed.");
  }
}

// src/index.ts
var { version } = createRequire(import.meta.url)("../package.json");
var main = defineCommand4({
  meta: {
    name: "rn-workflows",
    version,
    description: "Open-source CLI to generate Fastlane + GitHub Actions + GitLab CI from a single YAML config for React Native / Expo projects."
  },
  args: {
    cwd: {
      type: "string",
      description: "Working directory",
      default: process.cwd()
    }
  },
  subCommands: {
    init: init_default,
    generate: generate_default,
    setup: setup_default
  },
  async run({ args }) {
    await runMenu(String(args.cwd));
  }
});
runMain(main);
