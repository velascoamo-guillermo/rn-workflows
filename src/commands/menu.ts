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
  { value: 'view_profiles', label: 'View profiles (iOS)', hint: 'List provisioning profiles in match repo' },
  { value: 'view_devices', label: 'View devices (iOS)', hint: 'List registered devices from Apple Developer' },
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
      const initRun = initCommand.run;
      if (initRun) await initRun({ args: { cwd, force: false } as any, rawArgs: [], cmd: initCommand as any });
    } else if (choice === 'generate') {
      const generateRun = generateCommand.run;
      if (generateRun) await generateRun({ args: { cwd, config: 'rn-workflows.yml', 'dry-run': false } as any, rawArgs: [], cmd: generateCommand as any });
    } else if (choice === 'setup') {
      await handleSetupMenu(cwd);
    } else if (choice === 'add_testers') {
      await handleAddTesters();
    } else if (choice === 'add_device') {
      await handleAddDevice();
    } else if (choice === 'view_profiles') {
      await handleViewProfiles(cwd);
    } else if (choice === 'view_devices') {
      await handleViewDevices();
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
    p.log.error(err instanceof Error ? err.message : String(err));
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

async function handleViewProfiles(cwd: string): Promise<void> {
  let matchGitUrl = process.env['MATCH_GIT_URL'];
  if (!matchGitUrl) {
    matchGitUrl = await promptText('Match repo URL (MATCH_GIT_URL)', { placeholder: 'https://github.com/owner/match-repo.git' });
  }

  p.log.step('Fetching profiles from match repo...');

  const matchResult = matchGitUrl.match(/github\.com[/:](.+?)(?:\.git)?$/);
  if (!matchResult) {
    p.log.error(`Cannot parse GitHub repo from URL: ${matchGitUrl}`);
    return;
  }

  const repo = matchResult[1];
  const result = spawnSync('gh', ['api', `repos/${repo}/contents/profiles`, '--jq', '.[].name'], { encoding: 'utf8' });

  if (result.status !== 0 || !result.stdout.trim()) {
    p.log.warn('No profiles found or gh CLI not authenticated.');
    return;
  }

  const types = result.stdout.trim().split('\n');
  for (const type of types) {
    const profiles = spawnSync('gh', ['api', `repos/${repo}/contents/profiles/${type}`, '--jq', '.[].name'], { encoding: 'utf8' });
    if (profiles.stdout.trim()) {
      p.log.info(`${type}:`);
      for (const prof of profiles.stdout.trim().split('\n')) {
        p.log.step(`  ${prof}`);
      }
    }
  }
  p.log.success('Done.');
}

async function handleViewDevices(): Promise<void> {
  p.log.step('Fetching registered devices from Apple Developer...');
  const result = spawnSync(
    'bundle',
    ['exec', 'fastlane', 'ios', 'list_devices'],
    { encoding: 'utf8', stdio: 'inherit' },
  );

  if (result.status !== 0) {
    p.log.error('Failed. Make sure APPLE_ID is set and Fastlane is installed.');
  }
}
