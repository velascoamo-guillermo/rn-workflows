#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';
import { createRequire } from 'node:module';
import initCommand from './commands/init.ts';
import generateCommand from './commands/generate.ts';
import setupCommand from './commands/setup.ts';
import { runMenu } from './commands/menu.ts';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

const main = defineCommand({
  meta: {
    name: 'rn-workflows',
    version,
    description:
      'Open-source CLI to generate Fastlane + GitHub Actions + GitLab CI from a single YAML config for React Native / Expo projects.',
  },
  args: {
    cwd: {
      type: 'string',
      description: 'Working directory',
      default: process.cwd(),
    },
  },
  subCommands: {
    init: initCommand,
    generate: generateCommand,
    setup: setupCommand,
  },
  async run({ args }) {
    await runMenu(String(args.cwd));
  },
});

runMain(main);
