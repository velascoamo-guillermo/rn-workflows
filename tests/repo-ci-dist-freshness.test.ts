import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

interface Step {
  name?: string;
  run?: string;
  uses?: string;
}

interface WorkflowYaml {
  jobs: Record<string, { steps: Step[] }>;
}

describe("this repo's CI quality job enforces dist/ freshness (#41)", () => {
  const content = readFileSync(join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  const parsed = yaml.load(content) as WorkflowYaml;
  const steps = parsed.jobs.quality?.steps ?? [];

  test('rebuilds before checking, and fails on an unclean dist/', () => {
    const buildIndex = steps.findIndex((step) => step.run === 'bun run build');
    const checkIndex = steps.findIndex((step) => step.run === 'git diff --exit-code dist/');

    expect(buildIndex).toBeGreaterThanOrEqual(0);
    expect(checkIndex).toBeGreaterThan(buildIndex);
  });

  test('the freshness check step has a clear, human-readable name', () => {
    const checkStep = steps.find((step) => step.run === 'git diff --exit-code dist/');
    expect(checkStep?.name).toBe('Check dist is up to date');
  });
});
