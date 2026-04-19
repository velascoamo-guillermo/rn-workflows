#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';
import initCommand from './commands/init.ts';
import generateCommand from './commands/generate.ts';

const main = defineCommand({
  meta: {
    name: 'rn-workflows',
    version: '0.1.0',
    description:
      'Open-source CLI to generate Fastlane + GitHub Actions + GitLab CI from a single YAML config for React Native / Expo projects.',
  },
  subCommands: {
    init: initCommand,
    generate: generateCommand,
  },
});

runMain(main);
