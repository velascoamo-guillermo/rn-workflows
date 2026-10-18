import { defineCommand } from 'citty';
import { basename, dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import * as p from '@clack/prompts';
import { loadConfig, ConfigError } from '../config/parser.ts';
import { CI_PROVIDERS, type CiProvider, type Config } from '../config/schema.ts';
import { generateFastlane, type GeneratedFile } from '../generators/fastlane.ts';
import {
  generateGithubActions,
  type GithubActionsOptions,
} from '../generators/github-actions.ts';
import { generateGitlab } from '../generators/gitlab.ts';
import {
  generateMatrixWorkflow,
  MATRIX_WORKFLOW_FILENAME,
  type MatrixApp,
} from '../generators/github-matrix.ts';
import { writeFileEnsured } from '../utils/fs.ts';
import {
  assignUniqueSlugs,
  discoverConfigs,
  findGitRoot,
  resolveMatrixWorkflowsDir,
  resolveWorkflowsDir,
  slugify,
  toPosixRelative,
} from '../utils/monorepo.ts';
import { detectExpoScheme } from '../utils/expo.ts';
import {
  buildOtaSetupSection,
  checkOtaReadiness,
  type OtaSetupProfile,
} from '../utils/ota-setup.ts';
import {
  buildSetupMarkdown,
  deriveRequiredSecrets,
  requiredOnly,
  secretSetCommand,
  SETUP_MD_GENERATED_MARKER,
} from '../utils/secrets.ts';

function detectPackageManagerAt(dir: string): 'yarn' | 'npm' | 'bun' | null {
  if (existsSync(resolve(dir, 'bun.lock')) || existsSync(resolve(dir, 'bun.lockb'))) return 'bun';
  if (existsSync(resolve(dir, 'yarn.lock'))) return 'yarn';
  if (existsSync(resolve(dir, 'package-lock.json'))) return 'npm';
  return null;
}

function detectPackageManager(...dirs: string[]): 'yarn' | 'npm' | 'bun' {
  for (const dir of dirs) {
    const pm = detectPackageManagerAt(dir);
    if (pm) return pm;
  }
  return 'yarn';
}

interface WriteOptions {
  outDir: string;
  dryRun: boolean;
  /** When set, prints the derived required-secrets summary before the outro. */
  secretsSummary?: { secrets: ReturnType<typeof deriveRequiredSecrets>; ci: CiProvider };
}

function writeFiles(files: GeneratedFile[], { outDir, dryRun, secretsSummary }: WriteOptions): void {
  p.log.info(`${dryRun ? '[dry-run] ' : ''}Generating ${files.length} file(s) in ${outDir}`);
  for (const file of files) {
    const abs = resolve(outDir, file.path);
    if (dryRun) {
      p.log.step(`would write ${file.path} (${file.content.length} bytes)`);
    } else {
      writeFileEnsured(abs, file.content);
      p.log.step(`wrote ${file.path}`);
    }
  }
  if (secretsSummary && secretsSummary.secrets.length > 0) {
    const { secrets, ci } = secretsSummary;
    const required = requiredOnly(secrets);
    if (required.length > 0) {
      p.log.info(`Required CI secrets (${required.length}) — see SETUP.md for details:`);
      for (const req of required) {
        p.log.step(`${secretSetCommand(ci, req.name)} "<value>"`);
      }
      p.log.info('See SETUP.md for details. `rn-workflows setup` can collect and upload some of these for you.');
    }
  }
  p.outro(dryRun ? 'Dry run complete.' : 'Done.');
}

/**
 * `generate --matrix`: discover every rn-workflows.yml under the git root and
 * emit ONE strategy.matrix release workflow instead of N per-app workflows.
 * Fastlane files stay per-app — run plain `generate` inside each app dir;
 * once this workflow exists, per-app `generate` writes Fastlane files only.
 */
function runMatrix(args: {
  cwd: string;
  workflowsDirFlag?: string;
  dryRun: boolean;
}): void {
  const gitRoot = findGitRoot(args.cwd);
  if (!gitRoot) {
    p.log.error('generate --matrix requires running inside a git repository.');
    process.exit(1);
  }

  const configPaths = discoverConfigs(gitRoot);
  if (configPaths.length === 0) {
    p.log.error(`No rn-workflows.yml found under ${gitRoot}.`);
    p.log.info('Run `rn-workflows init` in each app directory first.');
    process.exit(1);
  }

  const apps: MatrixApp[] = [];
  for (const configPath of configPaths) {
    let config: Config;
    try {
      config = loadConfig(configPath);
    } catch (err) {
      if (err instanceof ConfigError) {
        p.log.error(`${configPath}: ${err.message}`);
        process.exit(1);
      }
      throw err;
    }
    if (config.ci !== 'github-actions') {
      p.log.warn(`Skipping ${configPath}: matrix workflows are GitHub Actions only.`);
      continue;
    }
    const appDirAbs = dirname(configPath);
    const dir = toPosixRelative(gitRoot, appDirAbs);
    // Per-app Xcode scheme (e2e simulator build), as in single-app generate.
    const scheme =
      config.project.scheme === undefined && config.project.type === 'expo'
        ? detectExpoScheme(appDirAbs)
        : undefined;
    apps.push({ dir, slug: slugify(basename(appDirAbs)), config, ...(scheme ? { scheme } : {}) });
  }
  if (apps.length === 0) {
    p.log.error('No github-actions configs discovered — nothing to generate.');
    process.exit(1);
  }

  // Unique slugs: keep the basename when unique, fall back to the full
  // path-derived slug on collision, fail loudly if slugs still collide.
  try {
    const slugs = assignUniqueSlugs(
      apps.map((app) => ({ dir: app.dir, baseSlug: app.slug })),
    );
    for (const [i, app] of apps.entries()) app.slug = slugs[i]!;
  } catch (err) {
    p.log.error((err as Error).message);
    process.exit(1);
  }

  const { dir: workflowsDir, warnings: workflowsDirWarnings } = resolveMatrixWorkflowsDir({
    gitRoot,
    ...(args.workflowsDirFlag ? { flag: args.workflowsDirFlag } : {}),
    apps: apps.map((app) => ({
      dir: app.dir,
      ...(app.config.workflowsDir ? { workflowsDir: app.config.workflowsDir } : {}),
    })),
  });
  for (const warning of workflowsDirWarnings) p.log.warn(warning);
  const packageManager = detectPackageManager(
    gitRoot,
    ...apps.map((app) => join(gitRoot, app.dir)),
  );

  p.log.info(
    `Matrix mode: ${apps.length} app(s) — ${apps.map((app) => app.slug).join(', ')}`,
  );
  const file = generateMatrixWorkflow(apps, {
    packageManager,
    workflowsDir,
    workflowsPathFromRoot: toPosixRelative(gitRoot, workflowsDir),
  });

  // Union of every discovered app's required secrets, deduped by name —
  // the matrix workflow is one file covering all of them, so its SETUP.md
  // and terminal summary must cover all of them too (deferred from #30).
  const requiredSecrets = dedupeSecretsByName(
    apps.flatMap((app) => deriveRequiredSecrets(app.config)),
  );

  const otaReports = apps.flatMap((app) =>
    collectOtaReadiness(app.config, join(gitRoot, app.dir), app.dir),
  );
  logOtaFindings(otaReports);

  const files: GeneratedFile[] = [file];
  if (requiredSecrets.length > 0) {
    const { path: setupMdPath, redirected } = resolveMatrixSetupMdPath(gitRoot);
    if (redirected) {
      p.log.warn(
        `SETUP.md already exists at ${gitRoot} and wasn't generated by rn-workflows — writing ${setupMdPath} instead.`,
      );
    }
    files.push({
      path: setupMdPath,
      content: buildSetupMarkdown(requiredSecrets, 'github-actions', [buildOtaSetupSection(otaReports)]),
    });
  }

  writeFiles(files, {
    outDir: gitRoot,
    dryRun: args.dryRun,
    secretsSummary: { secrets: requiredSecrets, ci: 'github-actions' },
  });
}

/**
 * The matrix workflow's SETUP.md is written at the git root, a much more
 * likely place for a repo to already keep its own hand-written SETUP.md
 * than an app subdirectory is. Never clobber one we didn't write: only
 * "SETUP.md" if it's absent or carries our marker as its first line
 * (meaning a previous `generate --matrix` run produced it); otherwise fall
 * back to "rn-workflows.SETUP.md" (#34 review minor).
 */
function resolveMatrixSetupMdPath(gitRoot: string): { path: string; redirected: boolean } {
  const target = join(gitRoot, 'SETUP.md');
  if (!existsSync(target)) return { path: 'SETUP.md', redirected: false };

  const firstLine = readFileSync(target, 'utf8').split('\n')[0]?.trim() ?? '';
  if (firstLine === SETUP_MD_GENERATED_MARKER) return { path: 'SETUP.md', redirected: false };

  return { path: 'rn-workflows.SETUP.md', redirected: true };
}

/** Path of an existing `rn-release-matrix.yml` (git-root default dir or the resolved one), else null. */
function findMatrixWorkflow(gitRoot: string | null, workflowsDir: string): string | null {
  const candidates = [
    ...(gitRoot ? [join(gitRoot, '.github', 'workflows', MATRIX_WORKFLOW_FILENAME)] : []),
    join(workflowsDir, MATRIX_WORKFLOW_FILENAME),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

function collectOtaReadiness(config: Config, appDir: string, app?: string): OtaSetupProfile[] {
  return Object.entries(config.build)
    .filter(([, profile]) => profile.ota)
    .map(([name, profile]) => ({
      ...(app ? { app } : {}),
      name,
      profile,
      findings: checkOtaReadiness(appDir, name, profile),
    }));
}

function logOtaFindings(reports: OtaSetupProfile[]): void {
  for (const r of reports) {
    for (const f of r.findings) {
      const text = r.app ? `${r.app}: ${f.message}` : f.message;
      if (f.level === 'warn') p.log.warn(text);
      else p.log.info(text);
    }
  }
}

function dedupeSecretsByName(
  secrets: ReturnType<typeof deriveRequiredSecrets>,
): ReturnType<typeof deriveRequiredSecrets> {
  const byName = new Map<string, ReturnType<typeof deriveRequiredSecrets>[number]>();
  for (const secret of secrets) byName.set(secret.name, secret);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export default defineCommand({
  meta: {
    name: 'generate',
    description: 'Generate Fastlane + CI files from rn-workflows.yml',
  },
  args: {
    config: {
      type: 'string',
      description: 'Path to rn-workflows.yml',
      default: 'rn-workflows.yml',
    },
    ci: {
      type: 'string',
      description: `Override CI provider. Valid: ${CI_PROVIDERS.join(', ')}`,
    },
    'dry-run': {
      type: 'boolean',
      description: 'Print what would be written without touching the filesystem',
      default: false,
    },
    cwd: {
      type: 'string',
      description: 'Working directory to write output into',
      default: process.cwd(),
    },
    'workflows-dir': {
      type: 'string',
      description:
        'Directory to emit GitHub workflow files into (relative paths resolve against --cwd). Overrides ci.workflowsDir. Default: <git root>/.github/workflows',
    },
    matrix: {
      type: 'boolean',
      description:
        'Monorepo mode: discover every rn-workflows.yml under the git root and emit a single strategy.matrix release workflow (GitHub Actions only)',
      default: false,
    },
  },
  async run({ args }) {
    if (args.matrix) {
      runMatrix({
        cwd: resolve(String(args.cwd)),
        ...(args['workflows-dir'] ? { workflowsDirFlag: String(args['workflows-dir']) } : {}),
        dryRun: Boolean(args['dry-run']),
      });
      return;
    }

    const configPath = resolve(String(args.cwd), String(args.config));
    if (!existsSync(configPath)) {
      p.log.error(`Config not found: ${configPath}`);
      p.log.info('Run `rn-workflows init` to create one.');
      process.exit(1);
    }

    let config;
    try {
      config = loadConfig(configPath);
    } catch (err) {
      if (err instanceof ConfigError) {
        p.log.error(err.message);
        process.exit(1);
      }
      throw err;
    }

    if (args.ci) {
      if (!(CI_PROVIDERS as readonly string[]).includes(String(args.ci))) {
        p.log.error(`Invalid --ci value. Valid: ${CI_PROVIDERS.join(', ')}`);
        process.exit(1);
      }
      config = { ...config, ci: args.ci as CiProvider };
    }

    const appDirAbs = resolve(String(args.cwd));
    const packageManager = detectPackageManager(appDirAbs);

    // `expo prebuild` names the Xcode project after `expo.name`, not the bundle
    // id — detect it unless the config pins `project.scheme` explicitly.
    const detectedScheme =
      config.project.scheme === undefined && config.project.type === 'expo'
        ? detectExpoScheme(appDirAbs)
        : undefined;
    if (detectedScheme) {
      p.log.info(`Detected Xcode scheme "${detectedScheme}" from app.json`);
    } else if (config.project.scheme === undefined && config.project.type === 'expo') {
      p.log.warn(
        'Could not read expo.name (dynamic app.config.js?). Falling back to the bundle id — set project.scheme in rn-workflows.yml if the Xcode scheme differs.',
      );
    }

    // Workflow files must live at the git root — GitHub only reads
    // .github/workflows there. Everything else stays in the app dir.
    const gitRoot = findGitRoot(appDirAbs);
    const appDir = gitRoot ? toPosixRelative(gitRoot, appDirAbs) : '';
    const workflowsDir = resolveWorkflowsDir({
      cwd: appDirAbs,
      gitRoot,
      ...(args['workflows-dir'] ? { flag: String(args['workflows-dir']) } : {}),
      ...(config.workflowsDir ? { configValue: config.workflowsDir } : {}),
    });

    const githubOptions: GithubActionsOptions = {
      packageManager,
      workflowsDir,
      ...(detectedScheme ? { scheme: detectedScheme } : {}),
      ...(appDir ? { appDir, appSlug: slugify(basename(appDirAbs)) } : {}),
      ...(gitRoot ? { workflowsPathFromRoot: toPosixRelative(gitRoot, workflowsDir) } : {}),
    };

    const requiredSecrets = deriveRequiredSecrets(config);
    // The OTA/e2e pipeline is GitHub Actions only: GitLab gets a plain
    // pipeline, so readiness checks and the SETUP.md OTA section don't apply.
    const otaProfiles = Object.entries(config.build).filter(([, profile]) => profile.ota);
    if (config.ci !== 'github-actions' && otaProfiles.length > 0) {
      p.log.warn(
        `ota/e2e are ignored for ${config.ci}: the fingerprint OTA + Maestro pipeline is GitHub Actions only (profiles: ${otaProfiles.map(([name]) => name).join(', ')}). A plain release pipeline was generated.`,
      );
    }
    const otaReports =
      config.ci === 'github-actions' ? collectOtaReadiness(config, appDirAbs) : [];
    logOtaFindings(otaReports);

    // A push-triggered matrix workflow already owns CI for this repo: a
    // per-app workflow next to it would run a second release pipeline per app.
    const matrixWorkflow =
      config.ci === 'github-actions' ? findMatrixWorkflow(gitRoot, workflowsDir) : null;
    if (matrixWorkflow) {
      p.log.info(
        `The matrix workflow owns CI for this repo (${matrixWorkflow}) — skipping the per-app workflow; only Fastlane files (and SETUP.md) were written.`,
      );
    }

    const files: GeneratedFile[] = [
      ...generateFastlane(config, { packageManager, scheme: detectedScheme }),
      ...(config.ci === 'github-actions'
        ? matrixWorkflow
          ? []
          : generateGithubActions(config, githubOptions)
        : generateGitlab(config)),
      ...(requiredSecrets.length > 0
        ? [{ path: 'SETUP.md', content: buildSetupMarkdown(requiredSecrets, config.ci, [buildOtaSetupSection(otaReports)]) }]
        : []),
    ];

    writeFiles(files, {
      outDir: String(args.cwd),
      dryRun: Boolean(args['dry-run']),
      secretsSummary: { secrets: requiredSecrets, ci: config.ci },
    });
  },
});
