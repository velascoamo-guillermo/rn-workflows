import { spawnSync } from 'node:child_process';

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function shell(cmd: string, args: string[]): ShellResult {
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  };
}

export function isAvailable(cmd: string): boolean {
  const result = spawnSync('which', [cmd], { encoding: 'utf8' });
  return result.status === 0;
}
