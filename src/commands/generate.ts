import { defineCommand } from 'citty';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import * as p from '@clack/prompts';
import { loadConfig, ConfigError } from '../config/parser.ts';
import { CI_PROVIDERS, type CiProvider } from '../config/schema.ts';
import { generateFastlane, type GeneratedFile } from '../generators/fastlane.ts';
import { generateGithubActions } from '../generators/github-actions.ts';
import { generateGitlab } from '../generators/gitlab.ts';
import { writeFileEnsured } from '../utils/fs.ts';

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

    const files: GeneratedFile[] = [
      ...generateFastlane(config),
      ...(config.ci === 'github-actions'
        ? generateGithubActions(config)
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
