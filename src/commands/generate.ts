import { defineCommand } from 'citty';
import { basename, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import * as p from '@clack/prompts';
import { loadConfig, ConfigError } from '../config/parser.ts';
import { CI_PROVIDERS, type CiProvider } from '../config/schema.ts';
import { generateFastlane, type GeneratedFile } from '../generators/fastlane.ts';
import {
  generateGithubActions,
  type GithubActionsOptions,
} from '../generators/github-actions.ts';
import { generateGitlab } from '../generators/gitlab.ts';
import { writeFileEnsured } from '../utils/fs.ts';
import {
  findGitRoot,
  resolveWorkflowsDir,
  slugify,
  toPosixRelative,
} from '../utils/monorepo.ts';

function detectPackageManager(cwd: string): 'yarn' | 'npm' | 'bun' {
  if (existsSync(resolve(cwd, 'bun.lock')) || existsSync(resolve(cwd, 'bun.lockb'))) return 'bun';
  if (existsSync(resolve(cwd, 'yarn.lock'))) return 'yarn';
  if (existsSync(resolve(cwd, 'package-lock.json'))) return 'npm';
  return 'yarn';
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
  },
  async run({ args }) {
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

    const outDir = String(args.cwd);
    const dryRun = Boolean(args['dry-run']);

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
  },
});
