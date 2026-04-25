// src/setup/prompts.ts
import * as p from '@clack/prompts';

export async function promptText(message: string, options?: { placeholder?: string; defaultValue?: string }): Promise<string> {
  const val = await p.text({ message, ...options, validate: v => (v?.trim() ? undefined : 'Required') });
  if (typeof val === 'symbol') { p.cancel('Cancelled.'); process.exit(0); }
  return val;
}

export async function promptPassword(message: string): Promise<string> {
  const val = await p.password({ message });
  if (typeof val === 'symbol') { p.cancel('Cancelled.'); process.exit(0); }
  return val;
}
