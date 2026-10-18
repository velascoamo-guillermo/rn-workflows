import { E2E_PLATFORMS, e2ePlatforms, type BuildProfile } from '../config/schema.ts';
import { readExpoUpdatesConfig } from './expo.ts';

export interface OtaFinding {
  level: 'warn' | 'note';
  message: string;
}

export interface OtaSetupProfile {
  /** App label (monorepo matrix); omitted for single-app generate. */
  app?: string;
  name: string;
  profile: BuildProfile;
  findings: OtaFinding[];
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/** Static checks of the app's Expo config against its `ota`/`e2e` build profile. */
export function checkOtaReadiness(appDir: string, profileName: string, profile: BuildProfile): OtaFinding[] {
  const ota = profile.ota;
  if (!ota) return [];
  const findings: OtaFinding[] = [];
  const warn = (message: string): void => void findings.push({ level: 'warn', message });
  const note = (message: string): void => void findings.push({ level: 'note', message });

  const cfg = readExpoUpdatesConfig(appDir);
  if (cfg.kind === 'dynamic') {
    warn(
      `Profile "${profileName}": the Expo config is dynamic (app.config.js/ts) and cannot be checked — make sure runtimeVersion is { policy: "fingerprint" }, updates.url points at ${ota.server} and updates.requestHeaders["expo-channel-name"] is "${ota.channel}".`,
    );
  } else if (cfg.kind === 'static') {
    if (!cfg.hasExpoUpdates) {
      warn(`Profile "${profileName}": expo-updates is not in package.json dependencies — install it (npx expo install expo-updates).`);
    }
    if (cfg.runtimePolicy !== 'fingerprint') {
      warn(`Profile "${profileName}": runtimeVersion must be { "policy": "fingerprint" } in the Expo config so native changes are detected.`);
    }
    const expectedHost = hostOf(ota.server);
    const actualHost = cfg.updatesUrl ? hostOf(cfg.updatesUrl) : undefined;
    if (!cfg.updatesUrl || actualHost !== expectedHost) {
      warn(
        `Profile "${profileName}": updates.url (${cfg.updatesUrl ?? 'unset'}) does not point at ota.server (${ota.server}); expected ${ota.server.replace(/\/+$/, '')}/api/manifest.`,
      );
    }
    if (cfg.channel !== ota.channel) {
      warn(
        `Profile "${profileName}": updates.requestHeaders["expo-channel-name"] is ${cfg.channel === undefined ? 'unset' : `"${cfg.channel}"`} but ota.channel is "${ota.channel}".`,
      );
    }
    if (!cfg.codeSigning) {
      note(
        `Profile "${profileName}": consider updates.codeSigningCertificate + codeSigningMetadata in the Expo config and setting the OTA server's signing key.`,
      );
    }
  }

  if (!profile.e2e) {
    note(`Profile "${profileName}": OTA updates ship untested — add an e2e (Maestro) block to run flows against the staging channel before promotion.`);
  } else {
    const tested = e2ePlatforms(profile);
    const shipped = E2E_PLATFORMS.filter((x) => profile.platform === 'all' || profile.platform === x);
    for (const p of shipped.filter((x) => !tested.includes(x))) {
      note(`Profile "${profileName}": ${p} OTA updates ship untested — e2e.maestro.platforms omits ${p}, so its updates go straight to the production channel.`);
    }
  }
  if (profile.e2e && e2ePlatforms(profile).includes('android')) {
    const host = hostOf(ota.server)?.replace(/:\d+$/, '');
    if (host && LOCAL_HOSTS.has(host)) {
      warn(
        `Profile "${profileName}": Android e2e runs on an emulator where localhost is the emulator itself, but ota.server is ${ota.server} — use a reachable hostname.`,
      );
    }
  }
  return findings;
}

const GUIDANCE = [
  '- Self-hosted runners need `jq`, `curl` and `git`. macOS self-hosted iOS e2e needs Xcode + `simctl`; Maestro is optional (the generated workflow installs a pinned Maestro if absent).',
  '- Render `Updates.updateId` in an element with testID `rnw-update-id` (hidden/debug-only is fine). A generated Maestro pre-flow asserts it equals the staging update id before your flows run.',
  '- Code signing for updates: set `updates.codeSigningCertificate` + `codeSigningMetadata` in the Expo config and the signing key on the OTA server.',
  '- The first run after upgrading from 0.2.x rebuilds natively once per platform (no legacy cache fallback).',
  '- Native tags `rnw/native/...` need the workflow\'s `contents: write` permission on native jobs and must not be blocked by tag rulesets.',
];

/** SETUP.md "OTA updates" section; empty string when no profile uses `ota`. */
export function buildOtaSetupSection(profiles: OtaSetupProfile[]): string {
  const withOta = profiles.filter((p) => p.profile.ota);
  if (withOta.length === 0) return '';
  const lines: string[] = ['## OTA updates', '', ...GUIDANCE, ''];
  const reported = withOta.filter((p) => p.findings.length > 0);
  if (reported.length > 0) {
    lines.push('### Readiness checks', '');
    for (const r of reported) {
      const label = r.app ? `${r.app}/${r.name}` : r.name;
      lines.push(`**${label}**`, '');
      for (const f of r.findings) lines.push(`- ${f.level === 'warn' ? 'Warning' : 'Note'}: ${f.message}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}
