import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig } from '../src/config/parser.ts';
import { generateFastlane } from '../src/generators/fastlane.ts';

/**
 * #38 review item: before_all silently skipped the ASC API key whenever any
 * one of ASC_KEY_ID/ASC_ISSUER_ID/ASC_KEY_CONTENT was empty, which looks
 * exactly like a config that never set them — CI then falls back to
 * Apple-ID auth and fails opaquely. Partial config should fail fast with a
 * clear message instead. All-unset (no ASC at all) must keep working, since
 * that's the normal path for devs without ASC configured yet.
 *
 * These run the generated `before_all` block for real under Ruby (not just
 * a string match on the template) — `before_all`, `UI.user_error!`, and
 * `app_store_connect_api_key` are stubbed, then the extracted block is
 * evaluated against different ASC_* env combinations.
 */

const fixture = (name: string) => readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8');

function extractBeforeAllBlock(fastfileContent: string): string {
  const match = fastfileContent.match(/before_all do[\s\S]*?\nend\n/);
  if (!match) throw new Error('before_all block not found in generated Fastfile');
  return match[0];
}

function runBeforeAll(block: string, env: Record<string, string>): { calls: unknown[] } {
  const script = `
def before_all
  yield
end

module UI
  def self.user_error!(msg)
    raise msg
  end
end

$calls = []
def app_store_connect_api_key(**kwargs)
  $calls << kwargs
end

${block}

require 'json'
STDOUT.write($calls.to_json)
`;
  const stdout = execFileSync('ruby', ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { calls: JSON.parse(stdout) };
}

describe('Fastfile before_all — ASC API key fail-fast (#34, #38 review)', () => {
  const beforeAllBlock = (() => {
    const cfg = parseConfig(fixture('production-all.yml'));
    const fastfile = generateFastlane(cfg).find((f) => f.path === 'fastlane/Fastfile')!;
    return extractBeforeAllBlock(fastfile.content);
  })();

  it('configures the API key when all three ASC vars are set', () => {
    const { calls } = runBeforeAll(beforeAllBlock, {
      ASC_KEY_ID: 'KEYID',
      ASC_ISSUER_ID: 'ISSUER',
      ASC_KEY_CONTENT: 'CONTENT',
    });
    expect(calls).toHaveLength(1);
  });

  it('does nothing and does not raise when all three ASC vars are unset (dev without ASC)', () => {
    const { calls } = runBeforeAll(beforeAllBlock, {
      ASC_KEY_ID: '',
      ASC_ISSUER_ID: '',
      ASC_KEY_CONTENT: '',
    });
    expect(calls).toHaveLength(0);
  });

  it('raises a clear error when only some ASC vars are set, instead of silently skipping', () => {
    expect(() =>
      runBeforeAll(beforeAllBlock, {
        ASC_KEY_ID: 'KEYID',
        ASC_ISSUER_ID: '',
        ASC_KEY_CONTENT: 'CONTENT',
      }),
    ).toThrow();
  });

  it('the partial-config error message names the missing var(s)', () => {
    try {
      runBeforeAll(beforeAllBlock, { ASC_KEY_ID: 'KEYID', ASC_ISSUER_ID: '', ASC_KEY_CONTENT: '' });
      throw new Error('expected runBeforeAll to throw');
    } catch (err) {
      const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? '';
      expect(stderr).toContain('ASC_ISSUER_ID');
      expect(stderr).toContain('ASC_KEY_CONTENT');
    }
  });
});
