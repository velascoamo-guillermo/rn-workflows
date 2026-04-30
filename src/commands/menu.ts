import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as p from '@clack/prompts';
import { spawnSync } from 'node:child_process';
import initCommand from './init.ts';
import generateCommand from './generate.ts';
import { makeFirebaseAppsStep, makeServiceAccountStep } from '../setup/firebase.ts';
import { makeMatchRepoStep } from '../setup/match.ts';
import { makeSecretsStep } from '../setup/secrets.ts';
import { runSteps } from '../setup/runner.ts';
import { loadConfig, ConfigError } from '../config/parser.ts';
import { promptText } from '../setup/prompts.ts';
import type { SetupContext } from '../setup/types.ts';

export const MENU_CHOICES = [
  { value: 'init', label: 'Init project', hint: 'Create rn-workflows.yml' },
  { value: 'generate', label: 'Generate files', hint: 'Fastlane + CI from rn-workflows.yml' },
  { value: 'setup', label: 'Setup CI/CD', hint: 'Firebase, Match, Secrets' },
  { value: 'add_testers', label: 'Add testers', hint: 'Firebase App Distribution' },
  { value: 'add_device', label: 'Add device (iOS)', hint: 'Register + regenerate match certs' },
  { value: 'exit', label: 'Exit' },
] as const;

export const SETUP_CHOICES = [
  { value: 'firebase', label: 'Firebase', hint: 'Create apps + service account' },
  { value: 'match', label: 'Match', hint: 'Create certificates repo' },
  { value: 'secrets', label: 'Secrets', hint: 'Upload to GitHub/GitLab' },
  { value: 'all', label: 'All', hint: 'Run all setup steps' },
  { value: 'back', label: 'Back' },
] as const;

export async function runMenu(cwd: string = process.cwd()): Promise<void> {
  p.intro('rn-workflows');

  while (true) {
    const choice = await p.select({
      message: 'What do you want to do?',
      options: MENU_CHOICES as unknown as Array<{ value: string; label: string; hint?: string }>,
    });

    if (typeof choice === 'symbol' || choice === 'exit') {
      p.outro('Bye!');
      break;
    }

    if (choice === 'init') {
      await (initCommand as any).run!({ args: { cwd, force: false, _: [] }, rawArgs: [], cmd: initCommand });
    } else if (choice === 'generate') {
      await (generateCommand as any).run!({ args: { cwd, config: 'rn-workflows.yml', 'dry-run': false, _: [] }, rawArgs: [], cmd: generateCommand });
    } else if (choice === 'setup') {
      await handleSetupMenu(cwd);
    } else if (choice === 'add_testers') {
      await handleAddTesters();
    } else if (choice === 'add_device') {
      await handleAddDevice();
    }
  }
}

async function handleSetupMenu(cwd: string): Promise<void> {
  const configPath = resolve(cwd, 'rn-workflows.yml');
  if (!existsSync(configPath)) {
    p.log.error('rn-workflows.yml not found. Run Init project first.');
    return;
  }

  let config;
  try {
    config = loadConfig(configPath);
  } catch (err) {
    if (err instanceof ConfigError) { p.log.error(err.message); return; }
    throw err;
  }

  const choice = await p.select({
    message: 'Setup — what do you want to configure?',
    options: SETUP_CHOICES as unknown as Array<{ value: string; label: string; hint?: string }>,
  });

  if (typeof choice === 'symbol' || choice === 'back') return;

  const ctx: SetupContext = {
    config,
    dryRun: false,
    collectedSecrets: {},
  };

  const stepsMap = {
    firebase: [makeFirebaseAppsStep(), makeServiceAccountStep()],
    match: [makeMatchRepoStep()],
    secrets: [makeSecretsStep()],
    all: [makeFirebaseAppsStep(), makeServiceAccountStep(), makeMatchRepoStep(), makeSecretsStep()],
  };

  const selectedSteps = stepsMap[choice as keyof typeof stepsMap];
  if (!selectedSteps) return;

  try {
    await runSteps(selectedSteps, ctx);
    p.log.success('Done!');
  } catch (err) {
    p.log.error((err as Error).message);
  }
}

async function handleAddTesters(): Promise<void> {
  const emails = await promptText('Tester emails (comma-separated)');
  const group = await promptText('Group alias', { defaultValue: 'internal-testers', placeholder: 'internal-testers' });

  p.log.step('Running fastlane add_testers...');
  const result = spawnSync(
    'bundle',
    ['exec', 'fastlane', 'add_testers', `emails:${emails}`, `group:${group}`],
    { encoding: 'utf8', stdio: 'inherit' },
  );

  if (result.status !== 0) {
    p.log.error('add_testers failed. Make sure Fastlane is installed and credentials are set.');
  } else {
    p.log.success('Testers added successfully.');
  }
}

async function handleAddDevice(): Promise<void> {
  const name = await promptText('Device name');
  const udid = await promptText('Device UDID');

  p.log.step('Running fastlane ios add_device...');
  const result = spawnSync(
    'bundle',
    ['exec', 'fastlane', 'ios', 'add_device', `name:${name}`, `udid:${udid}`],
    { encoding: 'utf8', stdio: 'inherit' },
  );

  if (result.status !== 0) {
    p.log.error('add_device failed. Make sure Apple credentials are configured.');
  } else {
    p.log.success('Device registered and match updated.');
  }
}
