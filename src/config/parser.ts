import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { ZodError } from 'zod';
import { ConfigSchema, type Config } from './schema.ts';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function parseConfig(raw: string): Config {
  let data: unknown;
  try {
    data = yaml.load(raw);
  } catch (err) {
    throw new ConfigError(`YAML parse error: ${(err as Error).message}`);
  }
  try {
    return ConfigSchema.parse(data);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new ConfigError(formatZodError(err));
    }
    throw err;
  }
}

export function loadConfig(path: string): Config {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new ConfigError(`Cannot read config at ${path}: ${(err as Error).message}`);
  }
  return parseConfig(raw);
}

function formatZodError(err: ZodError): string {
  const lines = err.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join('.') : '<root>';
    return `  - ${path}: ${issue.message}`;
  });
  return `Invalid rn-workflows.yml:\n${lines.join('\n')}`;
}
