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
