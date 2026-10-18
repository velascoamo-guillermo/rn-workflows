import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * `expo prebuild` names the Xcode project after the Expo `name` field, stripped
 * of every non-word character (`My App` -> `MyApp`), NOT after the bundle id.
 */
export function sanitizeSchemeName(name: string): string {
  return name.replace(/[\W_]+/g, '');
}

const APP_CONFIG_FILES = ['app.json', 'app.config.json'] as const;

/**
 * Best-effort read of `expo.name` (or top-level `name`) from a static Expo
 * config. Returns undefined when the project uses a dynamic `app.config.js` /
 * `app.config.ts`, in which case `project.scheme` must be set explicitly.
 */
export function detectExpoScheme(cwd: string): string | undefined {
  for (const file of APP_CONFIG_FILES) {
    let raw: string;
    try {
      raw = readFileSync(resolve(cwd, file), 'utf8');
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const name = readName(parsed);
    if (name) {
      const sanitized = sanitizeSchemeName(name);
      if (sanitized) return sanitized;
    }
  }
  return undefined;
}

function readName(parsed: unknown): string | undefined {
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const root = parsed as Record<string, unknown>;
  const expo = root['expo'];
  if (typeof expo === 'object' && expo !== null) {
    const nested = (expo as Record<string, unknown>)['name'];
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
  }
  const top = root['name'];
  if (typeof top === 'string' && top.trim()) return top.trim();
  return undefined;
}

export type ExpoUpdatesConfig =
  | { kind: 'none' }
  | { kind: 'dynamic' }
  | {
      kind: 'static';
      runtimePolicy: string | undefined;
      updatesUrl: string | undefined;
      channel: string | undefined;
      codeSigning: boolean;
      hasExpoUpdates: boolean;
    };

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function hasExpoUpdatesDep(appDir: string): boolean {
  try {
    const pkg = asRecord(JSON.parse(readFileSync(resolve(appDir, 'package.json'), 'utf8')));
    return ['dependencies', 'devDependencies'].some((k) => asRecord(pkg?.[k])?.['expo-updates'] !== undefined);
  } catch {
    return false;
  }
}

/**
 * Best-effort read of the OTA-relevant parts of a static Expo config. `dynamic`
 * when only app.config.js/ts exists (cannot be evaluated safely), `none` when
 * there is no config at all.
 */
export function readExpoUpdatesConfig(appDir: string): ExpoUpdatesConfig {
  for (const file of APP_CONFIG_FILES) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(resolve(appDir, file), 'utf8'));
    } catch {
      continue;
    }
    const root = asRecord(parsed);
    const expo = asRecord(root?.['expo']) ?? root;
    if (!expo) continue;
    const runtime = expo['runtimeVersion'];
    const updates = asRecord(expo['updates']);
    const headers = asRecord(updates?.['requestHeaders']);
    return {
      kind: 'static',
      runtimePolicy: str(asRecord(runtime)?.['policy']),
      updatesUrl: str(updates?.['url']),
      channel: str(headers?.['expo-channel-name']),
      codeSigning: updates?.['codeSigningCertificate'] !== undefined,
      hasExpoUpdates: hasExpoUpdatesDep(appDir),
    };
  }
  for (const f of ['app.config.js', 'app.config.ts', 'app.config.mjs', 'app.config.cjs']) {
    try {
      readFileSync(resolve(appDir, f));
      return { kind: 'dynamic' };
    } catch {
      /* next */
    }
  }
  return { kind: 'none' };
}
