import { describe, expect, it } from 'bun:test';
import {
  rubyString,
  rubySymbol,
  yamlScalar,
  yamlSingleQuoted,
} from '../src/utils/render.ts';

describe('rubyString', () => {
  it('leaves plain values untouched (byte-identical for safe input)', () => {
    expect(rubyString('com.gvelasco.pawlog')).toBe('com.gvelasco.pawlog');
  });

  it('escapes embedded double quotes', () => {
    expect(rubyString('Build "beta" (ios)')).toBe('Build \\"beta\\" (ios)');
  });

  it('escapes backslashes before quotes (order matters)', () => {
    expect(rubyString('He said "hi" \\ bye')).toBe('He said \\"hi\\" \\\\ bye');
  });

  it('never produces HTML entities for &, <, > (raw output, not HTML-escaped)', () => {
    expect(rubyString('a&b<c>d')).toBe('a&b<c>d');
  });
});

describe('rubySymbol', () => {
  it('renders a bare symbol for safe identifiers (byte-identical to today)', () => {
    expect(rubySymbol('production')).toBe(':production');
    expect(rubySymbol('devbuild')).toBe(':devbuild');
  });

  it('renders a quoted symbol for names with spaces', () => {
    expect(rubySymbol('my profile')).toBe(':"my profile"');
  });

  it('escapes embedded quotes inside a quoted symbol', () => {
    expect(rubySymbol('my "cool" profile')).toBe(':"my \\"cool\\" profile"');
  });
});

describe('yamlScalar', () => {
  it('leaves safe plain scalars untouched (byte-identical for safe input)', () => {
    expect(yamlScalar('rn-workflows • production')).toBe('rn-workflows • production');
    expect(yamlScalar('Build production (ios)')).toBe('Build production (ios)');
  });

  it('single-quotes and escapes values containing YAML-unsafe characters', () => {
    expect(yamlScalar("shared's & special/**")).toBe("'shared''s & special/**'");
  });

  it('quotes values with a colon so they are not read as a mapping', () => {
    expect(yamlScalar('path: with colon')).toBe("'path: with colon'");
  });

  it('quotes the empty string', () => {
    expect(yamlScalar('')).toBe("''");
  });
});

describe('yamlSingleQuoted', () => {
  it('leaves values without single quotes untouched', () => {
    expect(yamlSingleQuoted('packages/shared/**')).toBe('packages/shared/**');
  });

  it('doubles embedded single quotes per YAML single-quote scalar rules', () => {
    expect(yamlSingleQuoted("shared's path")).toBe("shared''s path");
  });
});
