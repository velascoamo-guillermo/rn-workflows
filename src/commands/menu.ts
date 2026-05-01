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
  { value: 'remove_testers', label: 'Remove testers', hint: 'Firebase App Distribution' },
  { value: 'add_device', label: 'Add device (iOS)', hint: 'Register + regenerate match certs' },
  { value: 'remove_device', label: 'Remove device (iOS)', hint: 'Disable device in Apple Developer' },
  { value: 'regenerate_certs', label: 'Regenerate certs (iOS)', hint: 'Force new match certs + profiles' },
  { value: 'view_profiles', label: 'View profiles (iOS)', hint: 'List provisioning profiles in match repo' },
  { value: 'view_devices', label: 'View devices (iOS)', hint: 'List registered devices from Apple Developer' },
  { value: 'configure_apple_auth', label: 'Configure Apple auth', hint: 'ASC API Key (.p8) or Apple ID + password' },
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
    } else if (choice === 'remove_testers') {
      await handleRemoveTesters();
    } else if (choice === 'add_device') {
      await handleAddDevice();
    } else if (choice === 'remove_device') {
      await handleRemoveDevice();
    } else if (choice === 'view_profiles') {
      await handleViewProfiles(cwd);
    } else if (choice === 'view_devices') {
      await handleViewDevices();
    } else if (choice === 'regenerate_certs') {
      await handleRegenCerts();
    } else if (choice === 'configure_apple_auth') {
      await handleConfigureAppleAuth(cwd);
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

  const needsMatch = (choice === 'match' || choice === 'all') &&
    Object.values(config.build).some(p => p.platform === 'ios' || p.platform === 'all');
  if (needsMatch) {
    const defaultName = `${config.project.bundleId.split('.').pop()}-match`;
    ctx.matchRepoName = await promptText('Match repo name', { defaultValue: defaultName, placeholder: defaultName });
    ctx.githubRepo = config.ci === 'github-actions'
      ? await promptText('GitHub repo (owner/repo)', { placeholder: 'owner/repo' })
      : undefined;
  }

  const needsSecrets = (choice === 'secrets' || choice === 'all');
  if (needsSecrets && !ctx.githubRepo && config.ci === 'github-actions') {
    ctx.githubRepo = await promptText('GitHub repo (owner/repo)', { placeholder: 'owner/repo' });
  }

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

async function handleRemoveTesters(): Promise<void> {
  const emails = await promptText('Tester emails to remove (comma-separated)');

  p.log.step('Running fastlane remove_testers...');
  const result = spawnSync(
    'bundle',
    ['exec', 'fastlane', 'remove_testers', `emails:${emails}`],
    { encoding: 'utf8', stdio: 'inherit' },
  );

  if (result.status !== 0) {
    p.log.error('remove_testers failed.');
  } else {
    p.log.success('Testers removed successfully.');
  }
}

async function handleRemoveDevice(): Promise<void> {
  const udid = await promptText('Device UDID to disable');

  p.log.step('Running fastlane ios remove_device...');
  const result = spawnSync(
    'bundle',
    ['exec', 'fastlane', 'ios', 'remove_device', `udid:${udid}`],
    { encoding: 'utf8', stdio: 'inherit' },
  );

  if (result.status !== 0) {
    p.log.error('remove_device failed. Make sure Apple credentials are configured.');
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
    p.log.error('Failed. Make sure Apple auth is configured (run Configure Apple auth).');
  }
}

async function handleRegenCerts(): Promise<void> {
  p.log.step('Regenerating certs and profiles via match...');
  const result = spawnSync(
    'bundle',
    ['exec', 'fastlane', 'ios', 'regenerate_certs'],
    { encoding: 'utf8', stdio: 'inherit' },
  );
  if (result.status !== 0) {
    p.log.error('regenerate_certs failed. Make sure MATCH_GIT_URL and MATCH_PASSWORD are set.');
  } else {
    p.log.success('Certs regenerated successfully.');
  }
}

async function handleConfigureAppleAuth(cwd: string): Promise<void> {
  const method = await p.select({
    message: 'Apple authentication method',
    options: [
      { value: 'asc', label: 'ASC API Key (.p8)', hint: 'Recommended — no password, no 2FA' },
      { value: 'appleid', label: 'Apple ID + password', hint: 'Requires 2FA on first use' },
    ],
  });

  if (typeof method === 'symbol') return;

  const envPath = resolve(cwd, 'fastlane', '.env');
  let existing = '';
  try {
    existing = (await import('node:fs')).readFileSync(envPath, 'utf8');
  } catch { /* file may not exist yet */ }

  const { writeFileSync } = await import('node:fs');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(resolve(cwd, 'fastlane'), { recursive: true });

  if (method === 'asc') {
    const keyId = await promptText('Key ID (from App Store Connect)');
    const issuerId = await promptText('Issuer ID (from App Store Connect)');
    const keyPath = await promptText('Path to .p8 file');

    let keyContent: string;
    try {
      keyContent = (await import('node:fs')).readFileSync(keyPath, 'utf8');
    } catch {
      p.log.error(`Cannot read file: ${keyPath}`);
      return;
    }

    const keyContentEscaped = keyContent.replace(/\n/g, '\\n');

    const newVars = [
      `ASC_KEY_ID=${keyId}`,
      `ASC_ISSUER_ID=${issuerId}`,
      `ASC_KEY_CONTENT="${keyContentEscaped}"`,
      `ASC_KEY_IS_BASE64=false`,
    ];

    const cleaned = existing
      .split('\n')
      .filter(l => !l.startsWith('ASC_') && !l.startsWith('FASTLANE_USER') && !l.startsWith('FASTLANE_PASSWORD'))
      .join('\n')
      .trim();

    writeFileSync(envPath, (cleaned ? cleaned + '\n' : '') + newVars.join('\n') + '\n');
    p.log.success(`ASC API Key saved to fastlane/.env`);

  } else {
    const email = await promptText('Apple ID email');
    const password = await (async () => {
      const val = await p.password({ message: 'Apple ID password' });
      if (typeof val === 'symbol') { p.cancel('Cancelled.'); process.exit(0); }
      return val;
    })();

    const newVars = [
      `FASTLANE_USER=${email}`,
      `FASTLANE_PASSWORD=${password}`,
    ];

    const cleaned = existing
      .split('\n')
      .filter(l => !l.startsWith('ASC_') && !l.startsWith('FASTLANE_USER') && !l.startsWith('FASTLANE_PASSWORD'))
      .join('\n')
      .trim();

    writeFileSync(envPath, (cleaned ? cleaned + '\n' : '') + newVars.join('\n') + '\n');
    p.log.success(`Apple ID saved to fastlane/.env`);
    p.log.warn('2FA required on first use — Fastlane will store session in Keychain.');
  }
}
