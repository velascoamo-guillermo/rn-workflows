import { defineCommand } from 'citty';
import { basename, dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import * as p from '@clack/prompts';
import { loadConfig, ConfigError } from '../config/parser.ts';
import { CI_PROVIDERS, type CiProvider, type Config } from '../config/schema.ts';
import { generateFastlane, type GeneratedFile } from '../generators/fastlane.ts';
import {
  generateGithubActions,
  type GithubActionsOptions,
} from '../generators/github-actions.ts';
import { generateGitlab } from '../generators/gitlab.ts';
import { generateMatrixWorkflow, type MatrixApp } from '../generators/github-matrix.ts';
import { writeFileEnsured } from '../utils/fs.ts';
import {
  discoverConfigs,
  findGitRoot,
  resolveWorkflowsDir,
  slugify,
  toPosixRelative,
} from '../utils/monorepo.ts';

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
}

function writeFiles(files: GeneratedFile[], { outDir, dryRun }: WriteOptions): void {
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
  p.outro(dryRun ? 'Dry run complete.' : 'Done.');
}

/**
 * `generate --matrix`: discover every rn-workflows.yml under the git root and
 * emit ONE strategy.matrix release workflow instead of N per-app workflows.
 * Fastlane files stay per-app — run plain `generate` inside each app dir.
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
    apps.push({ dir, slug: slugify(basename(appDirAbs)), config });
  }
  if (apps.length === 0) {
    p.log.error('No github-actions configs discovered — nothing to generate.');
    process.exit(1);
  }

  // De-duplicate slugs (two apps with the same dir basename) via full path.
  const slugCounts = new Map<string, number>();
  for (const app of apps) slugCounts.set(app.slug, (slugCounts.get(app.slug) ?? 0) + 1);
  for (const app of apps) {
    if ((slugCounts.get(app.slug) ?? 0) > 1 && app.dir !== '') app.slug = slugify(app.dir);
  }

  const workflowsDir = resolveWorkflowsDir({
    cwd: gitRoot,
    gitRoot,
    ...(args.workflowsDirFlag ? { flag: args.workflowsDirFlag } : {}),
  });
  const packageManager = detectPackageManager(
    gitRoot,
    ...apps.map((app) => join(gitRoot, app.dir)),
  );

  p.log.info(
    `Matrix mode: ${apps.length} app(s) — ${apps.map((app) => app.slug).join(', ')}`,
  );
  const file = generateMatrixWorkflow(apps, { packageManager, workflowsDir });
  writeFiles([file], { outDir: gitRoot, dryRun: args.dryRun });
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
      ...(appDir ? { appDir, appSlug: slugify(basename(appDirAbs)) } : {}),
    };

    const files: GeneratedFile[] = [
      ...generateFastlane(config, { packageManager }),
      ...(config.ci === 'github-actions'
        ? generateGithubActions(config, githubOptions)
        : generateGitlab(config)),
    ];

    writeFiles(files, { outDir: String(args.cwd), dryRun: Boolean(args['dry-run']) });
  },
});
