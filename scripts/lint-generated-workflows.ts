/**
 * Renders every tests/fixtures/*.yml through the GitHub Actions generators
 * into a tmp dir and runs `actionlint` on the output.
 *
 * - Legacy fixtures: shellcheck integration disabled (`-shellcheck=`), their
 *   output predates the shellcheck-clean guarantee.
 * - `ota-*.yml` fixtures: linted WITH shellcheck. Zero such fixtures is fine.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig } from '../src/config/parser.ts';
import { generateGithubActions } from '../src/generators/github-actions.ts';
import { generateMatrixWorkflow, type MatrixApp } from '../src/generators/github-matrix.ts';

const fixturesDir = resolve(import.meta.dir, '..', 'tests', 'fixtures');
const fixtures = readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.yml'))
  .sort();

/**
 * Known finding in the legacy smart (OTA) workflow: it interpolates
 * `github.event.head_commit.message` inside a `run:`. Fixing it changes
 * non-ota output (snapshots must stay byte-identical), so it is ignored for
 * the legacy group only. TODO: remove once the OTA rework lands.
 */
const LEGACY_IGNORES = ['"github.event.head_commit.message" is potentially untrusted'];

interface Group {
  label: string;
  shellcheck: boolean;
  files: string[];
}

function render(names: string[], root: string): string[] {
  const written: string[] = [];
  const dir = join(root, '.github', 'workflows');
  mkdirSync(dir, { recursive: true });
  const apps: MatrixApp[] = [];

  for (const name of names) {
    const config = loadConfig(join(fixturesDir, name));
    const slug = name.replace(/\.yml$/, '');
    for (const file of generateGithubActions(config, { workflowsDir: dir, appSlug: slug })) {
      writeFileSync(file.path, file.content);
      written.push(file.path);
    }
    apps.push({ dir: `apps/${slug}`, slug, config });
  }

  if (apps.length > 0) {
    const matrix = generateMatrixWorkflow(apps, { workflowsDir: dir });
    writeFileSync(matrix.path, matrix.content);
    written.push(matrix.path);
  }
  return written;
}

const tmp = mkdtempSync(join(tmpdir(), 'rn-workflows-actionlint-'));
let failed = false;

try {
  const groups: Group[] = [
    { label: 'legacy', shellcheck: false, files: [] },
    { label: 'ota', shellcheck: true, files: [] },
  ];
  groups[0]!.files = render(fixtures.filter((f) => !f.startsWith('ota-')), join(tmp, 'legacy'));
  groups[1]!.files = render(fixtures.filter((f) => f.startsWith('ota-')), join(tmp, 'ota'));

  for (const group of groups) {
    if (group.files.length === 0) {
      console.log(`[${group.label}] no fixtures, skipping`);
      continue;
    }
    const args = group.shellcheck
      ? [...group.files]
      : [
          '-shellcheck=',
          ...LEGACY_IGNORES.flatMap((pattern) => ['-ignore', pattern.replace(/[.]/g, '\\.')]),
          ...group.files,
        ];
    const result = spawnSync('actionlint', args, { stdio: 'inherit' });
    if (result.error) {
      console.error(`failed to run actionlint: ${result.error.message}`);
      failed = true;
    } else if (result.status !== 0) {
      console.error(`[${group.label}] actionlint reported problems`);
      failed = true;
    } else {
      console.log(`[${group.label}] ${group.files.length} workflow(s) clean`);
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
