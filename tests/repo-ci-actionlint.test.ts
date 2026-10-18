import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

interface Step {
  name?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
}

interface WorkflowYaml {
  jobs: Record<string, { steps: Step[] }>;
}

describe("this repo's CI lints generated workflows with actionlint (#46)", () => {
  const content = readFileSync(join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  const steps = (yaml.load(content) as WorkflowYaml).jobs.quality?.steps ?? [];
  const lintIndex = steps.findIndex((s) => s.run?.includes('scripts/lint-generated-workflows.ts'));
  const buildIndex = steps.findIndex((s) => s.run === 'bun run build');

  test('quality job runs the generated-workflow lint after build', () => {
    expect(buildIndex).toBeGreaterThanOrEqual(0);
    expect(lintIndex).toBeGreaterThan(buildIndex);
  });

  test('actionlint version is pinned', () => {
    const installStep = steps.find((s) => /actionlint/i.test(`${s.run ?? ''}${s.uses ?? ''}`) && s !== steps[lintIndex]);
    expect(installStep).toBeDefined();
    const text = `${installStep?.run ?? ''}${installStep?.uses ?? ''}${JSON.stringify(installStep?.env ?? {})}`;
    expect(text).not.toMatch(/latest/i);
    expect(text).toMatch(/\d+\.\d+\.\d+/);
    expect(steps.indexOf(installStep as Step)).toBeLessThan(lintIndex);
  });
});
