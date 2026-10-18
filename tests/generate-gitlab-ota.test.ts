import { describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** GitLab has no OTA/e2e pipeline: `generate` must say so and keep SETUP.md free of the OTA section. */
describe('generate --ci gitlab with ota', () => {
  const cli = resolve(import.meta.dir, '..', 'src', 'index.ts');
  const fixture = resolve(import.meta.dir, 'fixtures', 'ota-e2e-all.yml');

  function run(ci: string): { out: string; setup: string } {
    const root = mkdtempSync(join(tmpdir(), 'rnwf-gitlab-ota-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: root });
      const appDir = join(root, 'app');
      mkdirSync(appDir);
      copyFileSync(fixture, join(appDir, 'rn-workflows.yml'));
      const r = spawnSync('bun', [cli, 'generate', '--cwd', appDir, '--ci', ci], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      return { out: `${r.stdout}\n${r.stderr}`, setup: readFileSync(join(appDir, 'SETUP.md'), 'utf8') };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  test('warns that ota/e2e are ignored and SETUP.md omits the OTA section', () => {
    const { out, setup } = run('gitlab');
    expect(out).toMatch(/ota.*ignored|ignored.*ota/i);
    expect(setup).not.toContain('## OTA updates');
  });

  test('github-actions keeps the OTA section and no warning', () => {
    const { out, setup } = run('github-actions');
    expect(out).not.toMatch(/ota.*ignored|ignored.*ota/i);
    expect(setup).toContain('## OTA updates');
  });
});
