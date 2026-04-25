import type { Config } from '../config/types.ts';

export interface SetupContext {
  config: Config;
  dryRun: boolean;
  githubRepo?: string;
  gitlabProjectId?: string;
  gitlabToken?: string;
  firebaseProjectId?: string;
  matchRepoName?: string;
  collectedSecrets: Record<string, string>;
}

export interface StepResult {
  skipped: boolean;
  note?: string;
}

export interface Step {
  id: string;
  label: string;
  run: (ctx: SetupContext) => Promise<StepResult>;
}
