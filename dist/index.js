#!/usr/bin/env node
import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/index.ts
import { defineCommand as defineCommand4, runMain } from "citty";
import { createRequire as createRequire2 } from "node:module";

// src/commands/init.ts
import { defineCommand } from "citty";
import { existsSync, writeFileSync } from "node:fs";
import { resolve as resolve2 } from "node:path";
import * as p from "@clack/prompts";
import yaml from "js-yaml";

// src/config/schema.ts
import { z } from "zod";
var PLATFORMS = ["android", "ios", "all"];
var DISTRIBUTIONS = [
  "firebase",
  "testflight",
  "github-releases",
  "store"
];
var CI_PROVIDERS = ["github-actions", "gitlab"];
var PROJECT_TYPES = ["expo", "bare"];
var SINGLE_LINE_PATTERN = /^[^\r\n]*$/;
var SINGLE_LINE_MESSAGE = "must not contain newlines";
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
var OTA_SERVER_SAFE = /^https?:\/\/[A-Za-z0-9._~:/?#@%&=+-]+$/;
var OTA_CHANNEL_SAFE = /^[A-Za-z0-9_.-]+$/;
var OtaConfigSchema = z.object({
  server: z.string().min(1).regex(OTA_SERVER_SAFE, "ota.server must not contain whitespace or shell metacharacters"),
  channel: z.string().min(1).regex(OTA_CHANNEL_SAFE, "ota.channel may only contain letters, digits, dot, hyphen, underscore")
});
var BuildProfileSchema = z.object({
  platform: PlatformSchema,
  distribution: DistributionStringSchema,
  android: AndroidBuildOptionsSchema.optional(),
  ios: IosBuildOptionsSchema.optional(),
  ota: OtaConfigSchema.optional()
});
var MatchConfigSchema = z.object({
  gitUrl: z.string().min(1, "match.gitUrl cannot be empty").regex(SINGLE_LINE_PATTERN, `match.gitUrl ${SINGLE_LINE_MESSAGE}`),
  storageMode: z.literal("git").optional()
});
var TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/;
var IosProjectConfigSchema = z.object({
  developmentTeam: z.string().min(1, "developmentTeam cannot be empty").regex(TEAM_ID_PATTERN, "developmentTeam must be a 10-character Apple Team ID (A-Z, 0-9)").optional(),
  match: MatchConfigSchema.optional()
});
var BUNDLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
var ProjectSchema = z.object({
  type: ProjectTypeSchema,
  bundleId: z.string().min(1).regex(BUNDLE_ID_PATTERN, "bundleId may only contain letters, digits, dot, hyphen, underscore (unsafe otherwise for shell/xcargs interpolation)"),
  packageName: z.string().min(1).regex(SINGLE_LINE_PATTERN, `packageName ${SINGLE_LINE_MESSAGE}`),
  scheme: z.string().min(1).regex(SINGLE_LINE_PATTERN, `scheme ${SINGLE_LINE_MESSAGE}`).optional(),
  ios: IosProjectConfigSchema.optional()
});
var ChecksSchema = z.object({
  test: z.boolean().optional(),
  lint: z.boolean().optional(),
  typecheck: z.boolean().optional()
});
var CiObjectSchema = z.object({
  provider: CiSchema,
  workflowsDir: z.string().min(1, "workflowsDir cannot be empty").regex(SINGLE_LINE_PATTERN, `workflowsDir ${SINGLE_LINE_MESSAGE}`).optional(),
  extraPaths: z.array(z.string().min(1, "extraPaths entries cannot be empty").regex(SINGLE_LINE_PATTERN, `extraPaths entries ${SINGLE_LINE_MESSAGE}`)).optional()
});
var BUILD_PROFILE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
var ConfigSchema = z.object({
  project: ProjectSchema,
  ci: z.union([CiSchema, CiObjectSchema]),
  checks: ChecksSchema.optional(),
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
    if (!BUILD_PROFILE_NAME_PATTERN.test(name)) {
      ctx.addIssue({
        code: "custom",
        path: ["build", name],
        message: `build profile name "${name}" may only contain letters, digits, hyphen, underscore, and must start with a letter (unsafe otherwise as a Fastlane lane name / shell argument)`
      });
    }
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
}).transform((cfg) => {
  const ci = typeof cfg.ci === "string" ? { provider: cfg.ci } : cfg.ci;
  const out = {
    project: cfg.project,
    ci: ci.provider,
    build: cfg.build
  };
  if (cfg.checks !== undefined)
    out.checks = cfg.checks;
  if (ci.workflowsDir !== undefined)
    out.workflowsDir = ci.workflowsDir;
  if (ci.extraPaths !== undefined)
    out.extraPaths = ci.extraPaths;
  return out;
});

// src/utils/expo.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
function sanitizeSchemeName(name) {
  return name.replace(/[\W_]+/g, "");
}
var APP_CONFIG_FILES = ["app.json", "app.config.json"];
function detectExpoScheme(cwd) {
  for (const file of APP_CONFIG_FILES) {
    let raw;
    try {
      raw = readFileSync(resolve(cwd, file), "utf8");
    } catch {
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const name = readName(parsed);
    if (name) {
      const sanitized = sanitizeSchemeName(name);
      if (sanitized)
        return sanitized;
    }
  }
  return;
}
function readName(parsed) {
  if (typeof parsed !== "object" || parsed === null)
    return;
  const root = parsed;
  const expo = root["expo"];
  if (typeof expo === "object" && expo !== null) {
    const nested = expo["name"];
    if (typeof nested === "string" && nested.trim())
      return nested.trim();
  }
  const top = root["name"];
  if (typeof top === "string" && top.trim())
    return top.trim();
  return;
}

// src/commands/init.ts
var BUILD_PROFILE_NAMES = ["preview", "staging", "production"];
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
    },
    yes: {
      type: "boolean",
      description: "Non-interactive: skip all prompts, using flag values (or the same sane defaults the prompts use).",
      default: false
    },
    "project-type": {
      type: "string",
      description: `[--yes] Project type. Valid: ${PROJECT_TYPES.join(", ")}. Default: expo`
    },
    "bundle-id": {
      type: "string",
      description: "[--yes] iOS bundle identifier, e.g. com.myapp. Default: com.example.app"
    },
    "package-name": {
      type: "string",
      description: "[--yes] Android package name. Default: same as --bundle-id"
    },
    scheme: {
      type: "string",
      description: "[--yes] Xcode scheme (ios/<scheme>.xcworkspace). Default: auto-detected from app.json (Expo) or the bundle id tail"
    },
    ci: {
      type: "string",
      description: `[--yes] CI provider. Valid: ${CI_PROVIDERS.join(", ")}. Default: github-actions`
    },
    profiles: {
      type: "string",
      description: `[--yes] Comma-separated build profiles. Valid: ${BUILD_PROFILE_NAMES.join(", ")}. Default: preview,production`
    },
    distribution: {
      type: "string",
      description: `[--yes] Distribution(s) for preview/staging profiles, "+"-combinable. Valid: ${DISTRIBUTIONS.filter((d) => d !== "store").join(", ")}. Default: firebase`
    }
  },
  async run({ args }) {
    p.intro("rn-workflows init");
    const outPath = resolve2(String(args.cwd), "rn-workflows.yml");
    if (existsSync(outPath) && !args.force) {
      p.log.error(`${outPath} already exists. Pass --force to overwrite.`);
      process.exit(1);
    }
    let projectType;
    let bundleId;
    let packageName;
    let scheme;
    let ci;
    let profiles;
    let distributions;
    if (args.yes) {
      projectType = String(args["project-type"] ?? "expo");
      if (!PROJECT_TYPES.includes(projectType)) {
        p.log.error(`Invalid --project-type "${projectType}". Valid: ${PROJECT_TYPES.join(", ")}`);
        process.exit(1);
      }
      bundleId = String(args["bundle-id"] ?? "com.example.app");
      if (!bundleId.includes(".")) {
        p.log.error(`Invalid --bundle-id "${bundleId}" — must look like com.myapp.`);
        process.exit(1);
      }
      packageName = String(args["package-name"] ?? bundleId);
      const defaultScheme = (projectType === "expo" ? detectExpoScheme(String(args.cwd)) : undefined) ?? bundleId.split(".").pop() ?? "App";
      scheme = String(args.scheme ?? defaultScheme);
      ci = String(args.ci ?? "github-actions");
      if (!CI_PROVIDERS.includes(ci)) {
        p.log.error(`Invalid --ci "${ci}". Valid: ${CI_PROVIDERS.join(", ")}`);
        process.exit(1);
      }
      profiles = String(args.profiles ?? "preview,production").split(",").map((s) => s.trim()).filter(Boolean);
      const unknownProfiles = profiles.filter((name) => !BUILD_PROFILE_NAMES.includes(name));
      if (profiles.length === 0 || unknownProfiles.length > 0) {
        p.log.error(`Invalid --profiles "${profiles.join(",")}". Valid: ${BUILD_PROFILE_NAMES.join(", ")}`);
        process.exit(1);
      }
      const validDistributions = DISTRIBUTIONS.filter((d) => d !== "store");
      distributions = String(args.distribution ?? "firebase").split("+").map((s) => s.trim()).filter(Boolean);
      const unknownDistributions = distributions.filter((d) => !validDistributions.includes(d));
      if (distributions.length === 0 || unknownDistributions.length > 0) {
        p.log.error(`Invalid --distribution "${distributions.join("+")}". Valid: ${validDistributions.join(", ")} (combine with "+")`);
        process.exit(1);
      }
    } else {
      projectType = await p.select({
        message: "Project type",
        options: PROJECT_TYPES.map((t) => ({ value: t, label: t })),
        initialValue: "expo"
      });
      assertNotCancelled(projectType);
      bundleId = await p.text({
        message: "iOS bundle identifier (e.g. com.myapp)",
        placeholder: "com.myapp",
        validate: (v) => v && v.includes(".") ? undefined : "Must look like com.myapp"
      });
      assertNotCancelled(bundleId);
      packageName = await p.text({
        message: "Android package name",
        placeholder: bundleId,
        defaultValue: bundleId
      });
      assertNotCancelled(packageName);
      const defaultScheme = (projectType === "expo" ? detectExpoScheme(String(args.cwd)) : undefined) ?? bundleId.split(".").pop() ?? "App";
      scheme = await p.text({
        message: "Xcode scheme (ios/<scheme>.xcworkspace)",
        placeholder: defaultScheme,
        defaultValue: defaultScheme
      });
      assertNotCancelled(scheme);
      ci = await p.select({
        message: "CI provider",
        options: CI_PROVIDERS.map((c) => ({ value: c, label: c })),
        initialValue: "github-actions"
      });
      assertNotCancelled(ci);
      profiles = await p.multiselect({
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
      distributions = await p.multiselect({
        message: "Distributions to support (affects preview/staging only)",
        options: DISTRIBUTIONS.filter((d) => d !== "store").map((d) => ({ value: d, label: d })),
        initialValues: ["firebase"],
        required: true
      });
      assertNotCancelled(distributions);
    }
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
      project: { type: projectType, bundleId, packageName, scheme },
      ci,
      checks: { test: true, lint: true, typecheck: true },
      build
    };
    if (args.yes) {
      const result = ConfigSchema.safeParse(config);
      if (!result.success) {
        p.log.error("The requested flags produce an invalid rn-workflows.yml:");
        for (const issue of result.error.issues) {
          p.log.error(`  - ${issue.path.join(".") || "<root>"}: ${issue.message}`);
        }
        process.exit(1);
      }
    }
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
import { basename, dirname as dirname3, join as join3, resolve as resolve4 } from "node:path";
import { existsSync as existsSync2, readFileSync as readFileSync4 } from "node:fs";
import * as p2 from "@clack/prompts";

// src/config/parser.ts
import { readFileSync as readFileSync2 } from "node:fs";
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
    raw = readFileSync2(path, "utf8");
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
import { readFileSync as readFileSync3 } from "node:fs";
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
      return readFileSync3(p2, "utf8");
    } catch {}
  }
  throw new Error(`Template not found: ${relPath}`);
}
function rubyString(value) {
  return value.replace(/\\/g, "\\\\").replace(/#([{@$])/g, "\\#$1").replace(/"/g, "\\\"");
}
var RUBY_BARE_SYMBOL = /^[A-Za-z_][A-Za-z0-9_]*[?!=]?$/;
function rubySymbol(value) {
  if (RUBY_BARE_SYMBOL.test(value))
    return `:${value}`;
  return `:"${rubyString(value)}"`;
}
var YAML_UNSAFE_CHARS = /[:#[\]{}&*!|>'"%@`,\n\r\t]/;
var YAML_UNSAFE_LEADING = /^[\s\-?:,[\]{}#&*!|>'"%@`]/;
var YAML_RESERVED = /^(true|false|null|yes|no|on|off|~)$/i;
var YAML_NUMBER_LIKE = /^[-+]?(0x[0-9a-fA-F][0-9a-fA-F_]*|0o[0-7][0-7_]*|\d[\d_]*(\.\d[\d_]*)?([eE][-+]?\d+)?|\.\d[\d_]*([eE][-+]?\d+)?)$/;
var YAML_DATE_LIKE = /^\d{4}-\d{1,2}-\d{1,2}([Tt ]\d{1,2}:\d{2}:\d{2}(\.\d+)?(\s*(Z|z|[-+]\d{1,2}(:\d{2})?))?)?$/;
function needsYamlQuoting(value) {
  if (value === "")
    return true;
  if (/^\s/.test(value) || /\s$/.test(value))
    return true;
  if (YAML_UNSAFE_LEADING.test(value))
    return true;
  if (YAML_UNSAFE_CHARS.test(value))
    return true;
  if (YAML_RESERVED.test(value))
    return true;
  if (YAML_NUMBER_LIKE.test(value))
    return true;
  if (YAML_DATE_LIKE.test(value))
    return true;
  return false;
}
function yamlScalar(value) {
  if (!needsYamlQuoting(value))
    return value;
  return `'${value.replace(/'/g, "''")}'`;
}
function yamlSingleQuoted(value) {
  return value.replace(/'/g, "''");
}
function renderTemplate(relPath, data) {
  const tpl = resolveTemplate(relPath);
  const helpers = { rubyString, rubySymbol, yamlScalar, yamlSingleQuoted };
  return ejs.render(tpl, { ...helpers, ...data }, { rmWhitespace: false });
}

// src/generators/fastlane.ts
var MATCH_PROFILE_LABEL = {
  appstore: "AppStore",
  adhoc: "AdHoc",
  development: "Development"
};
var CODE_SIGN_IDENTITY = {
  appstore: "Apple Distribution",
  adhoc: "Apple Distribution",
  development: "Apple Development"
};
function matchTypeFor(exportMethod) {
  if (exportMethod === "ad-hoc")
    return "adhoc";
  if (exportMethod === "development")
    return "development";
  return "appstore";
}
function provisioningProfileName(matchType, bundleId) {
  return `match ${MATCH_PROFILE_LABEL[matchType]} ${bundleId}`;
}
function resolveScheme(config, detectedScheme) {
  return config.project.scheme ?? detectedScheme ?? config.project.bundleId.split(".").pop() ?? "App";
}
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
function toIosView(name, profile, bundleId, scheme) {
  const exportMethod = profile.ios?.exportMethod ?? "app-store";
  const targets = profile.distribution.split("+").map((s) => s.trim());
  const matchType = matchTypeFor(exportMethod);
  return {
    name,
    description: `Build ${name} (ios)`,
    targets,
    exportMethod,
    matchType,
    provisioningProfileName: provisioningProfileName(matchType, bundleId),
    codeSignIdentity: CODE_SIGN_IDENTITY[matchType],
    xcWorkspace: scheme,
    xcScheme: scheme
  };
}
function generateFastlane(config, options = {}) {
  const packageManager = options.packageManager ?? "yarn";
  const scheme = resolveScheme(config, options.scheme);
  const developmentTeam = config.project.ios?.developmentTeam;
  const match = config.project.ios?.match;
  const androidProfiles = [];
  const iosProfiles = [];
  for (const [name, profile] of Object.entries(config.build)) {
    if (profile.platform === "android" || profile.platform === "all") {
      androidProfiles.push(toAndroidView(name, profile));
    }
    if (profile.platform === "ios" || profile.platform === "all") {
      iosProfiles.push(toIosView(name, profile, config.project.bundleId, scheme));
    }
  }
  const allTargets = new Set(Object.values(config.build).flatMap((p2) => p2.distribution.split("+").map((s) => s.trim())));
  const fastfile = renderTemplate("fastlane/Fastfile.ejs", {
    androidProfiles,
    iosProfiles,
    defaultPlatform: androidProfiles.length > 0 ? "android" : "ios",
    projectType: config.project.type,
    bundleId: config.project.bundleId,
    packageName: config.project.packageName,
    packageManager,
    usesFirebase: allTargets.has("firebase"),
    hasIos: iosProfiles.length > 0,
    hasAndroidFirebase: androidProfiles.some((p2) => p2.targets.includes("firebase")),
    hasIosFirebase: iosProfiles.some((p2) => p2.targets.includes("firebase")),
    developmentTeam
  });
  const appfile = renderTemplate("fastlane/Appfile.ejs", {
    bundleId: config.project.bundleId,
    packageName: config.project.packageName,
    developmentTeam
  });
  const gemfile = renderTemplate("fastlane/Gemfile.ejs", {});
  const pluginfile = renderTemplate("fastlane/Pluginfile.ejs", {
    usesFirebase: allTargets.has("firebase")
  });
  const files = [
    { path: "fastlane/Fastfile", content: fastfile },
    { path: "fastlane/Appfile", content: appfile },
    { path: "fastlane/Pluginfile", content: pluginfile },
    { path: "Gemfile", content: gemfile }
  ];
  if (match) {
    const matchfile = renderTemplate("fastlane/Matchfile.ejs", {
      gitUrl: match.gitUrl,
      storageMode: match.storageMode ?? "git",
      bundleId: config.project.bundleId
    });
    files.push({ path: "fastlane/Matchfile", content: matchfile });
  }
  return files;
}

// src/secrets.ts
var ANDROID_SECRETS = {
  firebase: ["FIREBASE_APP_ID_ANDROID", "FIREBASE_SERVICE_ACCOUNT_JSON"],
  testflight: [],
  "github-releases": ["GITHUB_TOKEN"],
  store: ["PLAY_STORE_JSON_KEY"]
};
var APP_STORE_CONNECT_SECRETS = ["ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_KEY_CONTENT", "ASC_KEY_IS_BASE64"];
var IOS_SECRETS = {
  firebase: ["FIREBASE_APP_ID_IOS", "FIREBASE_SERVICE_ACCOUNT_JSON"],
  testflight: [...APP_STORE_CONNECT_SECRETS, "APPLE_TEAM_ID"],
  "github-releases": ["GITHUB_TOKEN"],
  store: [...APP_STORE_CONNECT_SECRETS, "APPLE_TEAM_ID"]
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
  const workflowsDir = options.workflowsDir ?? ".github/workflows";
  const appDir = options.appDir ?? "";
  const slugPrefix = options.appSlug ? `${options.appSlug}-` : "";
  const workflowsPathFromRoot = options.workflowsPathFromRoot ?? ".github/workflows";
  const extraPaths = config.extraPaths ?? [];
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
    const checks = config.checks ?? {};
    const hasChecks = checks.test || checks.lint || checks.typecheck;
    const filename = `rn-${slugPrefix}${name}.yml`;
    const templateData = {
      workflowName: `rn-workflows • ${name}`,
      branch: branchFor(name),
      jobs,
      packageManager,
      checks,
      hasChecks,
      appDir,
      extraPaths,
      selfPath: `${workflowsPathFromRoot}/${filename}`
    };
    const templateName = profile.ota ? "github/workflow-smart.ejs" : "github/workflow.ejs";
    const content = renderTemplate(templateName, {
      ...templateData,
      ...profile.ota ? { ota: profile.ota } : {}
    });
    files.push({ path: `${workflowsDir}/${filename}`, content });
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

// src/generators/github-matrix.ts
var MATRIX_WORKFLOW_FILENAME = "rn-release-matrix.yml";
function legDir(dir) {
  return dir === "" ? "." : dir;
}
function generateMatrixWorkflow(apps, options = {}) {
  if (apps.length === 0) {
    throw new Error("generateMatrixWorkflow requires at least one app");
  }
  const packageManager = options.packageManager ?? "yarn";
  const workflowsDir = options.workflowsDir ?? ".github/workflows";
  const qualityLegs = [];
  const releaseLegs = [];
  const secretUnion = new Set;
  let hasIos = false;
  for (const app of apps) {
    const checks = app.config.checks ?? {};
    if (checks.lint || checks.typecheck || checks.test) {
      qualityLegs.push({
        app: app.slug,
        dir: legDir(app.dir),
        lint: checks.lint ?? false,
        typecheck: checks.typecheck ?? false,
        test: checks.test ?? false
      });
    }
    for (const [profileName, profile] of Object.entries(app.config.build)) {
      const platforms = platformsFor(profile.platform);
      const hasOtaProfile = profile.ota !== undefined;
      const uploadPlatform = platforms.includes("android") ? "android" : platforms[0];
      for (const platform of platforms) {
        if (platform === "ios")
          hasIos = true;
        for (const secret of secretsFor(platform, profile.distribution)) {
          secretUnion.add(secret);
        }
        releaseLegs.push({
          app: app.slug,
          dir: legDir(app.dir),
          profile: profileName,
          platform,
          runsOn: platform === "ios" ? "macos-latest" : "ubuntu-latest",
          ota: hasOtaProfile,
          otaUpload: hasOtaProfile && platform === uploadPlatform,
          otaServer: profile.ota?.server ?? "",
          otaChannel: profile.ota?.channel ?? ""
        });
      }
    }
  }
  const secrets = [...secretUnion].sort();
  const hasOta = releaseLegs.some((leg) => leg.ota);
  const content = renderTemplate("github/workflow-matrix.ejs", {
    packageManager,
    qualityLegsJson: JSON.stringify(qualityLegs),
    releaseLegsJson: JSON.stringify(releaseLegs),
    hasQuality: qualityLegs.length > 0,
    hasOta,
    secrets,
    matchAuth: hasIos && secrets.includes("MATCH_PASSWORD")
  });
  return { path: `${workflowsDir}/${MATRIX_WORKFLOW_FILENAME}`, content };
}

// src/utils/fs.ts
import { mkdirSync, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname as dirname2 } from "node:path";
function writeFileEnsured(path, content) {
  mkdirSync(dirname2(path), { recursive: true });
  writeFileSync2(path, content, "utf8");
}

// src/utils/monorepo.ts
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join as join2, relative, resolve as resolve3, sep } from "node:path";
var CONFIG_FILENAME = "rn-workflows.yml";
function discoverConfigs(root) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith("."))
          continue;
        walk(join2(dir, entry.name));
      } else if (entry.isFile() && entry.name === CONFIG_FILENAME) {
        found.push(join2(dir, entry.name));
      }
    }
  };
  walk(root);
  return found.sort();
}
function findGitRoot(cwd) {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"]
    });
    const root = out.toString().trim();
    return root.length > 0 ? root : null;
  } catch {
    return null;
  }
}
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function assignUniqueSlugs(apps) {
  const baseCounts = new Map;
  for (const app of apps) {
    baseCounts.set(app.baseSlug, (baseCounts.get(app.baseSlug) ?? 0) + 1);
  }
  const slugs = apps.map((app) => (baseCounts.get(app.baseSlug) ?? 0) > 1 && app.dir !== "" ? slugify(app.dir) : app.baseSlug);
  const dirsBySlug = new Map;
  slugs.forEach((slug, i) => {
    const dir = apps[i].dir === "" ? "." : apps[i].dir;
    dirsBySlug.set(slug, [...dirsBySlug.get(slug) ?? [], dir]);
  });
  const collisions = [...dirsBySlug.entries()].filter(([, dirs]) => dirs.length > 1);
  if (collisions.length > 0) {
    const detail = collisions.map(([slug, dirs]) => `"${slug}" (from ${dirs.join(", ")})`).join("; ");
    throw new Error(`App slugs collide even after path derivation: ${detail}. Rename the app directories so they produce distinct slugs.`);
  }
  return slugs;
}
function toPosixRelative(from, to) {
  return relative(from, to).split(sep).join("/");
}
function resolveWorkflowsDir(input) {
  const { cwd, gitRoot, flag, configValue } = input;
  if (flag)
    return resolve3(cwd, flag);
  if (configValue)
    return resolve3(cwd, configValue);
  return join2(gitRoot ?? cwd, ".github", "workflows");
}
function resolveMatrixWorkflowsDir(input) {
  const { gitRoot, flag, apps } = input;
  if (flag)
    return { dir: resolve3(gitRoot, flag), warnings: [] };
  const declared = apps.filter((app) => app.workflowsDir !== undefined);
  if (declared.length === 0) {
    return { dir: join2(gitRoot, ".github", "workflows"), warnings: [] };
  }
  const values = new Set(declared.map((app) => app.workflowsDir));
  if (declared.length === apps.length && values.size === 1) {
    return { dir: resolve3(gitRoot, declared[0].workflowsDir), warnings: [] };
  }
  const ignored = declared.map((app) => `${app.dir === "" ? "." : app.dir} (${app.workflowsDir})`).join(", ");
  return {
    dir: join2(gitRoot, ".github", "workflows"),
    warnings: [
      `Matrix mode ignores per-app ci.workflowsDir unless every app declares the same value. Ignored: ${ignored}. Using the default <git root>/.github/workflows — pass --workflows-dir to override.`
    ]
  };
}

// src/utils/secrets.ts
var OPTIONAL_SECRETS = new Set(["ASC_KEY_IS_BASE64"]);
var SECRET_DESCRIPTIONS = {
  FIREBASE_APP_ID_ANDROID: "Firebase App Distribution app id for the Android app. Firebase console → Project settings → General → Your apps.",
  FIREBASE_APP_ID_IOS: "Firebase App Distribution app id for the iOS app. Firebase console → Project settings → General → Your apps.",
  FIREBASE_SERVICE_ACCOUNT_JSON: "Firebase service account JSON (full file contents) with App Distribution admin access. Firebase console → Project settings → Service accounts → Generate new private key.",
  PLAY_STORE_JSON_KEY: "Google Play service account JSON key with Release Manager access. Play Console → Setup → API access → Service accounts.",
  ASC_KEY_ID: "App Store Connect API key ID (10-character identifier shown next to the key). App Store Connect → Users and Access → Integrations → App Store Connect API.",
  ASC_ISSUER_ID: "App Store Connect API issuer ID (UUID shown above the keys table). App Store Connect → Users and Access → Integrations → App Store Connect API.",
  ASC_KEY_CONTENT: 'Contents of the downloaded .p8 private key file — raw by default, or base64-encoded if ASC_KEY_IS_BASE64 is "true". fastlane\'s `app_store_connect_api_key(key_content:)` reads it directly from this env var, no file materialization step needed. App Store Connect → Users and Access → Integrations → App Store Connect API → generate/download a key (only downloadable once, so save it).',
  ASC_KEY_IS_BASE64: 'Set to "true" when ASC_KEY_CONTENT is stored base64-encoded, "false" (or unset) for raw .p8 contents. The .p8 file is multiline and most CI secret stores (notably GitLab, whose masking rejects multiline values) can\'t mask it as-is — base64-encoding collapses it to one line so it can be masked. `rn-workflows setup` offers to encode it for you.',
  APPLE_TEAM_ID: "Your 10-character Apple Developer Team ID. Read by fastlane's Appfile as a fallback whenever `project.ios.developmentTeam` is left unset in rn-workflows.yml — but the generated CI workflow declares this secret unconditionally for every testflight/store iOS job regardless, so set it either way. App Store Connect → Membership.",
  MATCH_PASSWORD: "Passphrase that decrypts the fastlane match certificates repo. Choose one when running `fastlane match init`.",
  MATCH_GIT_URL: "Git URL of the private repo storing fastlane match's encrypted certificates, e.g. `https://github.com/org/certificates.git`. Read directly by fastlane's `match` action from the environment. If `project.ios.match.gitUrl` is set in rn-workflows.yml the generated Matchfile also carries the URL, but the CI workflow still declares this secret unconditionally — set it regardless.",
  MATCH_GIT_BASIC_AUTHORIZATION: 'Base64-encoded `username:token` with read access to the match certificates repo, e.g. `echo -n "user:token" | base64`.',
  GITHUB_TOKEN: "GitHub token with permission to create Releases on the app repo, used by the `github-releases` distribution target. On GitHub Actions the default `secrets.GITHUB_TOKEN` usually suffices (may need `contents: write` permission); on GitLab, create a personal access token against the GitHub repo instead.",
  OTA_UPLOAD_KEY: "Shared upload key the OTA server accepts on `/api/upload`. Set the same value on the OTA server and here. Only rendered for GitHub Actions today — the gitlab-ci generator does not emit an OTA job."
};
function requirement(name) {
  const description = SECRET_DESCRIPTIONS[name];
  if (!description)
    throw new Error(`No description registered for secret "${name}" — add one to SECRET_DESCRIPTIONS.`);
  return OPTIONAL_SECRETS.has(name) ? { name, description, optional: true } : { name, description };
}
function deriveRequiredSecrets(config) {
  const required = new Map;
  const isGithub = config.ci === "github-actions";
  for (const profile of Object.values(config.build)) {
    for (const platform of platformsFor(profile.platform)) {
      for (const name of secretsFor(platform, profile.distribution)) {
        required.set(name, requirement(name));
      }
      if (platform === "ios" && isGithub) {
        required.set("MATCH_GIT_BASIC_AUTHORIZATION", requirement("MATCH_GIT_BASIC_AUTHORIZATION"));
      }
    }
    if (profile.ota && isGithub) {
      required.set("OTA_UPLOAD_KEY", requirement("OTA_UPLOAD_KEY"));
    }
  }
  return [...required.values()].sort((a, b) => a.name.localeCompare(b.name));
}
function secretSetCommand(ci, name) {
  return ci === "gitlab" ? `glab variable set ${name}` : `gh secret set ${name}`;
}
function requiredOnly(secrets) {
  return secrets.filter((s) => !s.optional);
}
var SETUP_MD_GENERATED_MARKER = "<!-- rn-workflows:generated -->";
function buildSetupMarkdown(secrets, ci) {
  const lines = [
    SETUP_MD_GENERATED_MARKER,
    "# CI secrets setup",
    "",
    "Auto-generated by `rn-workflows generate`. Regenerate with `npx rn-workflows generate`.",
    "",
    "These are the CI secrets the generated Fastlane and CI files read at build time.",
    "`rn-workflows setup` can collect and upload some of these for you — check each",
    "entry below, since not every secret here has a setup step yet.",
    ""
  ];
  for (const req of secrets) {
    lines.push(`## ${req.name}${req.optional ? " (optional)" : ""}`, "", req.description, "", "```sh", `${secretSetCommand(ci, req.name)} "<value>"`, "```", "");
  }
  return lines.join(`
`);
}

// src/commands/generate.ts
function detectPackageManagerAt(dir) {
  if (existsSync2(resolve4(dir, "bun.lock")) || existsSync2(resolve4(dir, "bun.lockb")))
    return "bun";
  if (existsSync2(resolve4(dir, "yarn.lock")))
    return "yarn";
  if (existsSync2(resolve4(dir, "package-lock.json")))
    return "npm";
  return null;
}
function detectPackageManager(...dirs) {
  for (const dir of dirs) {
    const pm = detectPackageManagerAt(dir);
    if (pm)
      return pm;
  }
  return "yarn";
}
function writeFiles(files, { outDir, dryRun, secretsSummary }) {
  p2.log.info(`${dryRun ? "[dry-run] " : ""}Generating ${files.length} file(s) in ${outDir}`);
  for (const file of files) {
    const abs = resolve4(outDir, file.path);
    if (dryRun) {
      p2.log.step(`would write ${file.path} (${file.content.length} bytes)`);
    } else {
      writeFileEnsured(abs, file.content);
      p2.log.step(`wrote ${file.path}`);
    }
  }
  if (secretsSummary && secretsSummary.secrets.length > 0) {
    const { secrets, ci } = secretsSummary;
    const required = requiredOnly(secrets);
    if (required.length > 0) {
      p2.log.info(`Required CI secrets (${required.length}) — see SETUP.md for details:`);
      for (const req of required) {
        p2.log.step(`${secretSetCommand(ci, req.name)} "<value>"`);
      }
      p2.log.info("See SETUP.md for details. `rn-workflows setup` can collect and upload some of these for you.");
    }
  }
  p2.outro(dryRun ? "Dry run complete." : "Done.");
}
function runMatrix(args) {
  const gitRoot = findGitRoot(args.cwd);
  if (!gitRoot) {
    p2.log.error("generate --matrix requires running inside a git repository.");
    process.exit(1);
  }
  const configPaths = discoverConfigs(gitRoot);
  if (configPaths.length === 0) {
    p2.log.error(`No rn-workflows.yml found under ${gitRoot}.`);
    p2.log.info("Run `rn-workflows init` in each app directory first.");
    process.exit(1);
  }
  const apps = [];
  for (const configPath of configPaths) {
    let config;
    try {
      config = loadConfig(configPath);
    } catch (err) {
      if (err instanceof ConfigError) {
        p2.log.error(`${configPath}: ${err.message}`);
        process.exit(1);
      }
      throw err;
    }
    if (config.ci !== "github-actions") {
      p2.log.warn(`Skipping ${configPath}: matrix workflows are GitHub Actions only.`);
      continue;
    }
    const appDirAbs = dirname3(configPath);
    const dir = toPosixRelative(gitRoot, appDirAbs);
    apps.push({ dir, slug: slugify(basename(appDirAbs)), config });
  }
  if (apps.length === 0) {
    p2.log.error("No github-actions configs discovered — nothing to generate.");
    process.exit(1);
  }
  try {
    const slugs = assignUniqueSlugs(apps.map((app) => ({ dir: app.dir, baseSlug: app.slug })));
    for (const [i, app] of apps.entries())
      app.slug = slugs[i];
  } catch (err) {
    p2.log.error(err.message);
    process.exit(1);
  }
  const { dir: workflowsDir, warnings: workflowsDirWarnings } = resolveMatrixWorkflowsDir({
    gitRoot,
    ...args.workflowsDirFlag ? { flag: args.workflowsDirFlag } : {},
    apps: apps.map((app) => ({
      dir: app.dir,
      ...app.config.workflowsDir ? { workflowsDir: app.config.workflowsDir } : {}
    }))
  });
  for (const warning of workflowsDirWarnings)
    p2.log.warn(warning);
  const packageManager = detectPackageManager(gitRoot, ...apps.map((app) => join3(gitRoot, app.dir)));
  p2.log.info(`Matrix mode: ${apps.length} app(s) — ${apps.map((app) => app.slug).join(", ")}`);
  const file = generateMatrixWorkflow(apps, { packageManager, workflowsDir });
  const requiredSecrets = dedupeSecretsByName(apps.flatMap((app) => deriveRequiredSecrets(app.config)));
  const files = [file];
  if (requiredSecrets.length > 0) {
    const { path: setupMdPath, redirected } = resolveMatrixSetupMdPath(gitRoot);
    if (redirected) {
      p2.log.warn(`SETUP.md already exists at ${gitRoot} and wasn't generated by rn-workflows — writing ${setupMdPath} instead.`);
    }
    files.push({ path: setupMdPath, content: buildSetupMarkdown(requiredSecrets, "github-actions") });
  }
  writeFiles(files, {
    outDir: gitRoot,
    dryRun: args.dryRun,
    secretsSummary: { secrets: requiredSecrets, ci: "github-actions" }
  });
}
function resolveMatrixSetupMdPath(gitRoot) {
  const target = join3(gitRoot, "SETUP.md");
  if (!existsSync2(target))
    return { path: "SETUP.md", redirected: false };
  const firstLine = readFileSync4(target, "utf8").split(`
`)[0]?.trim() ?? "";
  if (firstLine === SETUP_MD_GENERATED_MARKER)
    return { path: "SETUP.md", redirected: false };
  return { path: "rn-workflows.SETUP.md", redirected: true };
}
function dedupeSecretsByName(secrets) {
  const byName = new Map;
  for (const secret of secrets)
    byName.set(secret.name, secret);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
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
    },
    "workflows-dir": {
      type: "string",
      description: "Directory to emit GitHub workflow files into (relative paths resolve against --cwd). Overrides ci.workflowsDir. Default: <git root>/.github/workflows"
    },
    matrix: {
      type: "boolean",
      description: "Monorepo mode: discover every rn-workflows.yml under the git root and emit a single strategy.matrix release workflow (GitHub Actions only)",
      default: false
    }
  },
  async run({ args }) {
    if (args.matrix) {
      runMatrix({
        cwd: resolve4(String(args.cwd)),
        ...args["workflows-dir"] ? { workflowsDirFlag: String(args["workflows-dir"]) } : {},
        dryRun: Boolean(args["dry-run"])
      });
      return;
    }
    const configPath = resolve4(String(args.cwd), String(args.config));
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
    const appDirAbs = resolve4(String(args.cwd));
    const packageManager = detectPackageManager(appDirAbs);
    const detectedScheme = config.project.scheme === undefined && config.project.type === "expo" ? detectExpoScheme(appDirAbs) : undefined;
    if (detectedScheme) {
      p2.log.info(`Detected Xcode scheme "${detectedScheme}" from app.json`);
    } else if (config.project.scheme === undefined && config.project.type === "expo") {
      p2.log.warn("Could not read expo.name (dynamic app.config.js?). Falling back to the bundle id — set project.scheme in rn-workflows.yml if the Xcode scheme differs.");
    }
    const gitRoot = findGitRoot(appDirAbs);
    const appDir = gitRoot ? toPosixRelative(gitRoot, appDirAbs) : "";
    const workflowsDir = resolveWorkflowsDir({
      cwd: appDirAbs,
      gitRoot,
      ...args["workflows-dir"] ? { flag: String(args["workflows-dir"]) } : {},
      ...config.workflowsDir ? { configValue: config.workflowsDir } : {}
    });
    const githubOptions = {
      packageManager,
      workflowsDir,
      ...appDir ? { appDir, appSlug: slugify(basename(appDirAbs)) } : {},
      ...gitRoot ? { workflowsPathFromRoot: toPosixRelative(gitRoot, workflowsDir) } : {}
    };
    const requiredSecrets = deriveRequiredSecrets(config);
    const files = [
      ...generateFastlane(config, { packageManager, scheme: detectedScheme }),
      ...config.ci === "github-actions" ? generateGithubActions(config, githubOptions) : generateGitlab(config),
      ...requiredSecrets.length > 0 ? [{ path: "SETUP.md", content: buildSetupMarkdown(requiredSecrets, config.ci) }] : []
    ];
    writeFiles(files, {
      outDir: String(args.cwd),
      dryRun: Boolean(args["dry-run"]),
      secretsSummary: { secrets: requiredSecrets, ci: config.ci }
    });
  }
});

// src/commands/setup.ts
import { defineCommand as defineCommand3 } from "citty";
import { resolve as resolve5 } from "node:path";
import { existsSync as existsSync5 } from "node:fs";
import * as p6 from "@clack/prompts";

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
import { join as join4 } from "node:path";
import { unlinkSync, readFileSync as readFileSync5 } from "node:fs";

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
async function promptConfirm(message, initialValue = false) {
  const val = await p4.confirm({ message, initialValue });
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
      const tmpPath = join4(tmpdir(), `rn-workflows-sa-${Date.now()}.json`);
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
        json = readFileSync5(tmpPath, "utf8");
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
    run(ctx) {
      const hasIos = Object.values(ctx.config.build).some((p5) => p5.platform === "ios" || p5.platform === "all");
      if (!hasIos)
        return { skipped: true, note: "no iOS builds" };
      const repoName = ctx.matchRepoName.replace(/^https?:\/\/[^/]+\//, "").replace(/\.git$/, "");
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
        if (!isAvailable("glab"))
          throw new Error("glab CLI not found. Install from https://gitlab.com/gitlab-org/cli");
        const check = shell("glab", ["repo", "view", repoName]);
        if (check.exitCode === 0) {
          const urlLine = check.stdout.split(`
`).find((l) => l.includes("http"));
          ctx.collectedSecrets["MATCH_GIT_URL"] = urlLine?.trim() ?? `https://gitlab.com/${repoName}.git`;
          return { skipped: true, note: "repo already exists" };
        }
        const r = shell("glab", ["repo", "create", repoName, "--private", "--description", "Fastlane Match certificates", "--defaultBranch", "main"]);
        if (r.exitCode !== 0)
          throw new Error(`glab repo create failed: ${r.stderr}`);
        ctx.collectedSecrets["MATCH_GIT_URL"] = `https://gitlab.com/${repoName}.git`;
        return { skipped: false, note: repoName };
      }
      throw new Error(`Unsupported CI: ${ctx.config.ci}`);
    }
  };
}

// src/setup/secrets.ts
import * as p5 from "@clack/prompts";
function collectRequiredSecrets(config) {
  return requiredOnly(deriveRequiredSecrets(config)).map((s) => s.name);
}
function makeSecretsStep() {
  return {
    id: "secrets",
    label: "Upload CI secrets",
    async run(ctx) {
      const required = collectRequiredSecrets(ctx.config);
      const missing = required.filter((k) => !ctx.collectedSecrets[k]);
      let uploaded = 0;
      let uploadNote;
      if (ctx.config.ci === "github-actions") {
        if (!isAvailable("gh")) {
          throw new Error("gh CLI not found. Install from https://cli.github.com");
        }
        const existing = getExistingGithubSecrets(ctx.githubRepo);
        for (const [key, value] of Object.entries(ctx.collectedSecrets)) {
          if (existing.has(key))
            continue;
          const result = shell("gh", ["secret", "set", key, "--body", value, "--repo", ctx.githubRepo]);
          if (result.exitCode !== 0)
            throw new Error(`gh secret set ${key} failed: ${result.stderr}`);
          uploaded++;
        }
        uploadNote = uploaded > 0 ? `${uploaded} secrets uploaded` : "all already set";
      } else if (ctx.config.ci === "gitlab") {
        if (!isAvailable("glab")) {
          throw new Error("glab CLI not found. Install from https://gitlab.com/gitlab-org/cli");
        }
        const existing = getExistingGitlabVariables(ctx.gitlabProjectId);
        for (const [key, value] of Object.entries(ctx.collectedSecrets)) {
          if (existing.has(key))
            continue;
          const result = shell("glab", ["variable", "set", key, "--value", value, "--repo", ctx.gitlabProjectId]);
          if (result.exitCode !== 0)
            throw new Error(`glab variable set ${key} failed: ${result.stderr}`);
          uploaded++;
        }
        uploadNote = uploaded > 0 ? `${uploaded} secrets uploaded` : "all already set";
      } else {
        throw new Error(`Unsupported CI: ${ctx.config.ci}`);
      }
      if (missing.length === 0) {
        return { skipped: uploaded === 0, note: uploadNote };
      }
      p5.log.warn(`${missing.length} required secret(s) were not collected — set them manually:`);
      for (const name of missing) {
        p5.log.step(`${secretSetCommand(ctx.config.ci, name)} "<value>"`);
      }
      return {
        skipped: false,
        note: `${uploadNote}; still required: ${missing.join(", ")}`
      };
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
function getExistingGitlabVariables(projectId) {
  const result = shell("glab", ["variable", "list", "--repo", projectId, "--output", "json"]);
  if (result.exitCode !== 0)
    return new Set;
  const vars = JSON.parse(result.stdout || "[]");
  return new Set(vars.map((v) => v.key));
}

// src/setup/appstore.ts
import { existsSync as existsSync3, readFileSync as readFileSync6 } from "node:fs";
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
      ctx.collectedSecrets["ASC_KEY_ID"] = await promptText("App Store Connect API key ID");
      ctx.collectedSecrets["ASC_ISSUER_ID"] = await promptText("App Store Connect API issuer ID");
      const keyPath = await promptText("Path to the downloaded .p8 App Store Connect API key file");
      if (!existsSync3(keyPath))
        throw new Error(`File not found: ${keyPath}`);
      const keyContent = readFileSync6(keyPath, "utf8");
      const useBase64 = await promptConfirm("Store the key as base64? (recommended for GitLab — multiline secrets cannot be masked there)");
      ctx.collectedSecrets["ASC_KEY_CONTENT"] = useBase64 ? Buffer.from(keyContent, "utf8").toString("base64") : keyContent;
      ctx.collectedSecrets["ASC_KEY_IS_BASE64"] = useBase64 ? "true" : "false";
      return { skipped: false };
    }
  };
}

// src/setup/playstore.ts
import { existsSync as existsSync4, readFileSync as readFileSync7 } from "node:fs";
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
      ctx.collectedSecrets["PLAY_STORE_JSON_KEY"] = readFileSync7(keyPath, "utf8");
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
    p6.intro("rn-workflows setup");
    const configPath = resolve5(String(args.cwd), String(args.config));
    if (!existsSync5(configPath)) {
      p6.log.error(`Config not found: ${configPath}`);
      p6.log.info("Run `rn-workflows init` first.");
      process.exit(1);
    }
    let config;
    try {
      config = loadConfig(configPath);
    } catch (err) {
      if (err instanceof ConfigError) {
        p6.log.error(err.message);
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
        const raw = await p6.text({
          message: "GitHub repo (owner/repo)",
          validate: (v) => v && v.includes("/") ? undefined : "Format: owner/repo"
        });
        assertNotCancelled2(raw);
        ctx.githubRepo = String(raw);
      }
    }
    if (config.ci === "gitlab") {
      if (!isAvailable("glab")) {
        p6.log.error("glab CLI not found. Install from https://gitlab.com/gitlab-org/cli");
        process.exit(1);
      }
      const rawProjectId = await p6.text({ message: "GitLab project path (namespace/repo)", validate: (v) => v?.trim() ? undefined : "Required" });
      assertNotCancelled2(rawProjectId);
      ctx.gitlabProjectId = String(rawProjectId);
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
        const rawMatchRepo = await p6.text({
          message: "Match repo name",
          placeholder: defaultName,
          defaultValue: defaultName
        });
        assertNotCancelled2(rawMatchRepo);
        ctx.matchRepoName = String(rawMatchRepo);
      }
      const rawPw = await p6.password({ message: "Match encryption password (MATCH_PASSWORD)" });
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
      makeAppStoreStep(),
      makePlayStoreStep(),
      makeSecretsStep()
    ], ctx);
    p6.log.success("Setup complete!");
    if (hasIos) {
      p6.log.warn("Next: seed match certificates manually:");
      p6.log.info("  MATCH_READONLY=false bundle exec fastlane match adhoc");
    }
    p6.outro("Done.");
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
        const chosen = await p6.select({
          message: "Select Firebase project",
          options: projects.map((pr) => ({ value: pr.projectId, label: `${pr.displayName} (${pr.projectId})` }))
        });
        if (typeof chosen === "symbol") {
          p6.cancel("Cancelled.");
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
    p6.cancel("Cancelled.");
    process.exit(0);
  }
}

// src/commands/menu.ts
import { existsSync as existsSync6 } from "node:fs";
import { resolve as resolve6 } from "node:path";
import * as p7 from "@clack/prompts";
import { spawnSync as spawnSync2 } from "node:child_process";
var MENU_CHOICES = [
  { value: "init", label: "Init project", hint: "Create rn-workflows.yml" },
  { value: "generate", label: "Generate files", hint: "Fastlane + CI from rn-workflows.yml" },
  { value: "setup", label: "Setup CI/CD", hint: "Firebase, Match, Secrets" },
  { value: "add_testers", label: "Add testers", hint: "Firebase App Distribution" },
  { value: "remove_testers", label: "Remove testers", hint: "Firebase App Distribution" },
  { value: "add_device", label: "Add device (iOS)", hint: "Register + regenerate match certs" },
  { value: "remove_device", label: "Remove device (iOS)", hint: "Disable device in Apple Developer" },
  { value: "regenerate_certs", label: "Regenerate certs (iOS)", hint: "Force new match certs + profiles" },
  { value: "view_profiles", label: "View profiles (iOS)", hint: "List provisioning profiles in match repo" },
  { value: "view_devices", label: "View devices (iOS)", hint: "List registered devices from Apple Developer" },
  { value: "configure_apple_auth", label: "Configure Apple auth", hint: "ASC API Key (.p8) or Apple ID + password" },
  { value: "exit", label: "Exit" }
];
var SETUP_CHOICES = [
  { value: "firebase", label: "Firebase", hint: "Create apps + service account" },
  { value: "match", label: "Match", hint: "Create certificates repo" },
  { value: "secrets", label: "Secrets", hint: "Upload to GitHub/GitLab" },
  { value: "all", label: "All", hint: "Run all setup steps" },
  { value: "back", label: "Back" }
];
function buildSetupSteps(choice) {
  const stepsMap = {
    firebase: [makeFirebaseAppsStep(), makeServiceAccountStep()],
    match: [makeMatchRepoStep()],
    secrets: [makeSecretsStep()],
    all: [
      makeFirebaseAppsStep(),
      makeServiceAccountStep(),
      makeMatchRepoStep(),
      makeAppStoreStep(),
      makeSecretsStep()
    ]
  };
  return stepsMap[choice];
}
async function runMenu(cwd = process.cwd()) {
  p7.intro("rn-workflows");
  while (true) {
    const choice = await p7.select({
      message: "What do you want to do?",
      options: MENU_CHOICES
    });
    if (typeof choice === "symbol" || choice === "exit") {
      p7.outro("Bye!");
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
    } else if (choice === "regenerate_certs") {
      await handleRegenCerts();
    } else if (choice === "configure_apple_auth") {
      await handleConfigureAppleAuth(cwd);
    }
  }
}
async function handleSetupMenu(cwd) {
  const configPath = resolve6(cwd, "rn-workflows.yml");
  if (!existsSync6(configPath)) {
    p7.log.error("rn-workflows.yml not found. Run Init project first.");
    return;
  }
  let config;
  try {
    config = loadConfig(configPath);
  } catch (err) {
    if (err instanceof ConfigError) {
      p7.log.error(err.message);
      return;
    }
    throw err;
  }
  const choice = await p7.select({
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
  const needsMatch = (choice === "match" || choice === "all") && Object.values(config.build).some((p8) => p8.platform === "ios" || p8.platform === "all");
  if (needsMatch) {
    const defaultName = `${config.project.bundleId.split(".").pop()}-match`;
    ctx.matchRepoName = await promptText("Match repo name", { defaultValue: defaultName, placeholder: defaultName });
    if (config.ci === "github-actions") {
      const raw = await promptText("GitHub repo (owner/repo)", { placeholder: "owner/repo" });
      ctx.githubRepo = raw.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
    }
  }
  const needsSecrets = choice === "secrets" || choice === "all";
  if (needsSecrets && !ctx.githubRepo && config.ci === "github-actions") {
    const raw = await promptText("GitHub repo (owner/repo)", { placeholder: "owner/repo" });
    ctx.githubRepo = raw.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
  }
  const selectedSteps = buildSetupSteps(choice);
  try {
    await runSteps(selectedSteps, ctx);
    p7.log.success("Done!");
  } catch (err) {
    p7.log.error(err instanceof Error ? err.message : String(err));
  }
}
async function handleAddTesters() {
  const emails = await promptText("Tester emails (comma-separated)");
  const group = await promptText("Group alias", { defaultValue: "internal-testers", placeholder: "internal-testers" });
  p7.log.step("Running fastlane add_testers...");
  const result = spawnSync2("bundle", ["exec", "fastlane", "add_testers", `emails:${emails}`, `group:${group}`], { encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) {
    p7.log.error("add_testers failed. Make sure Fastlane is installed and credentials are set.");
  } else {
    p7.log.success("Testers added successfully.");
  }
}
async function handleAddDevice() {
  const name = await promptText("Device name");
  const udid = await promptText("Device UDID");
  p7.log.step("Running fastlane ios add_device...");
  const result = spawnSync2("bundle", ["exec", "fastlane", "ios", "add_device", `name:${name}`, `udid:${udid}`], { encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) {
    p7.log.error("add_device failed. Make sure Apple credentials are configured.");
  } else {
    p7.log.success("Device registered and match updated.");
  }
}
async function handleRemoveTesters() {
  const emails = await promptText("Tester emails to remove (comma-separated)");
  p7.log.step("Running fastlane remove_testers...");
  const result = spawnSync2("bundle", ["exec", "fastlane", "remove_testers", `emails:${emails}`], { encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) {
    p7.log.error("remove_testers failed.");
  } else {
    p7.log.success("Testers removed successfully.");
  }
}
async function handleRemoveDevice() {
  const udid = await promptText("Device UDID to disable");
  p7.log.step("Running fastlane ios remove_device...");
  const result = spawnSync2("bundle", ["exec", "fastlane", "ios", "remove_device", `udid:${udid}`], { encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) {
    p7.log.error("remove_device failed. Make sure Apple credentials are configured.");
  }
}
async function handleViewProfiles(_cwd) {
  let matchGitUrl = process.env["MATCH_GIT_URL"];
  if (!matchGitUrl) {
    matchGitUrl = await promptText("Match repo URL (MATCH_GIT_URL)", { placeholder: "https://github.com/owner/match-repo.git" });
  }
  p7.log.step("Fetching profiles from match repo...");
  const matchResult = matchGitUrl.match(/github\.com[/:](.+?)(?:\.git)?$/);
  if (!matchResult) {
    p7.log.error(`Cannot parse GitHub repo from URL: ${matchGitUrl}`);
    return;
  }
  const repo = matchResult[1];
  const result = spawnSync2("gh", ["api", `repos/${repo}/contents/profiles`, "--jq", ".[].name"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) {
    p7.log.warn("No profiles found or gh CLI not authenticated.");
    return;
  }
  const types = result.stdout.trim().split(`
`);
  for (const type of types) {
    const profiles = spawnSync2("gh", ["api", `repos/${repo}/contents/profiles/${type}`, "--jq", ".[].name"], { encoding: "utf8" });
    if (profiles.stdout.trim()) {
      p7.log.info(`${type}:`);
      for (const prof of profiles.stdout.trim().split(`
`)) {
        p7.log.step(`  ${prof}`);
      }
    }
  }
  p7.log.success("Done.");
}
async function handleViewDevices() {
  p7.log.step("Fetching registered devices from Apple Developer...");
  const result = spawnSync2("bundle", ["exec", "fastlane", "ios", "list_devices"], { encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) {
    p7.log.error("Failed. Make sure Apple auth is configured (run Configure Apple auth).");
  }
}
async function handleRegenCerts() {
  p7.log.step("Regenerating certs and profiles via match...");
  const result = spawnSync2("bundle", ["exec", "fastlane", "ios", "regenerate_certs"], { encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) {
    p7.log.error("regenerate_certs failed. Make sure MATCH_GIT_URL and MATCH_PASSWORD are set.");
  } else {
    p7.log.success("Certs regenerated successfully.");
  }
}
async function handleConfigureAppleAuth(cwd) {
  const method = await p7.select({
    message: "Apple authentication method",
    options: [
      { value: "asc", label: "ASC API Key (.p8)", hint: "Recommended — no password, no 2FA" },
      { value: "appleid", label: "Apple ID + password", hint: "Requires 2FA on first use" }
    ]
  });
  if (typeof method === "symbol")
    return;
  const envPath = resolve6(cwd, "fastlane", ".env");
  let existing = "";
  try {
    existing = (await import("node:fs")).readFileSync(envPath, "utf8");
  } catch {}
  const { writeFileSync: writeFileSync3 } = await import("node:fs");
  const { mkdirSync: mkdirSync2 } = await import("node:fs");
  mkdirSync2(resolve6(cwd, "fastlane"), { recursive: true });
  if (method === "asc") {
    const keyId = await promptText("Key ID (from App Store Connect)");
    const issuerId = await promptText("Issuer ID (from App Store Connect)");
    const keyPath = await promptText("Path to .p8 file");
    let keyContent;
    try {
      keyContent = (await import("node:fs")).readFileSync(keyPath, "utf8");
    } catch {
      p7.log.error(`Cannot read file: ${keyPath}`);
      return;
    }
    const keyContentEscaped = keyContent.replace(/\n/g, "\\n");
    const newVars = [
      `ASC_KEY_ID=${keyId}`,
      `ASC_ISSUER_ID=${issuerId}`,
      `ASC_KEY_CONTENT="${keyContentEscaped}"`,
      `ASC_KEY_IS_BASE64=false`
    ];
    const cleaned = existing.split(`
`).filter((l) => !l.startsWith("ASC_") && !l.startsWith("FASTLANE_USER") && !l.startsWith("FASTLANE_PASSWORD")).join(`
`).trim();
    writeFileSync3(envPath, (cleaned ? cleaned + `
` : "") + newVars.join(`
`) + `
`);
    p7.log.success(`ASC API Key saved to fastlane/.env`);
  } else {
    const email = await promptText("Apple ID email");
    const password4 = await (async () => {
      const val = await p7.password({ message: "Apple ID password" });
      if (typeof val === "symbol") {
        p7.cancel("Cancelled.");
        process.exit(0);
      }
      return val;
    })();
    const newVars = [
      `FASTLANE_USER=${email}`,
      `FASTLANE_PASSWORD=${password4}`
    ];
    const cleaned = existing.split(`
`).filter((l) => !l.startsWith("ASC_") && !l.startsWith("FASTLANE_USER") && !l.startsWith("FASTLANE_PASSWORD")).join(`
`).trim();
    writeFileSync3(envPath, (cleaned ? cleaned + `
` : "") + newVars.join(`
`) + `
`);
    p7.log.success(`Apple ID saved to fastlane/.env`);
    p7.log.warn("2FA required on first use — Fastlane will store session in Keychain.");
  }
}

// src/utils/cli.ts
function shouldRunMenu(positionals, subCommandNames) {
  const first = positionals[0];
  return typeof first !== "string" || !subCommandNames.includes(first);
}

// src/index.ts
var { version } = createRequire2(import.meta.url)("../package.json");
var subCommands = {
  init: init_default,
  generate: generate_default,
  setup: setup_default
};
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
  subCommands,
  async run({ args }) {
    const positionals = Array.isArray(args._) ? args._ : [];
    if (!shouldRunMenu(positionals, Object.keys(subCommands)))
      return;
    await runMenu(String(args.cwd));
  }
});
runMain(main);
