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

  it('neutralizes #{...} so it cannot execute as Ruby interpolation (#40 critical)', () => {
    const out = rubyString('https://example.com/repo.git#{ENV["SECRET"]}');
    // The escaped form must still be a syntactically valid Ruby double-quoted
    // string body once re-wrapped in "...": a backslash-escaped #{.
    expect(out).toBe('https://example.com/repo.git\\#{ENV[\\"SECRET\\"]}');
  });

  it('neutralizes #@ and #$ (the other Ruby interpolation triggers)', () => {
    expect(rubyString('a#@ivar')).toBe('a\\#@ivar');
    expect(rubyString('a#$global')).toBe('a\\#$global');
  });

  it('leaves a bare # untouched when not followed by {, @, or $', () => {
    expect(rubyString('https://example.com/repo.git#readme')).toBe(
      'https://example.com/repo.git#readme',
    );
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

  it('quotes hex-number-like values (YAML 1.1 core schema int)', () => {
    expect(yamlScalar('0x1A')).toBe("'0x1A'");
    expect(yamlScalar('-0x1a')).toBe("'-0x1a'");
  });

  it('quotes octal-number-like values', () => {
    expect(yamlScalar('0o17')).toBe("'0o17'");
  });

  it('quotes exponent-number-like values', () => {
    expect(yamlScalar('1e10')).toBe("'1e10'");
    expect(yamlScalar('1.5e-10')).toBe("'1.5e-10'");
  });

  it('quotes underscore-grouped-number-like values', () => {
    expect(yamlScalar('1_000')).toBe("'1_000'");
  });

  it('quotes ISO-date-like values (YAML timestamp)', () => {
    expect(yamlScalar('2024-01-15')).toBe("'2024-01-15'");
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
