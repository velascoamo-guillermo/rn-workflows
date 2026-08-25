import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';

const here = dirname(fileURLToPath(import.meta.url));

function resolveTemplate(relPath: string): string {
  const candidates = [
    // dev: src/utils/render.ts → src/templates/<relPath>
    join(here, '..', 'templates', relPath),
    // bundled dist/index.js at package root → src/templates/<relPath>
    join(here, '..', 'src', 'templates', relPath),
    // nested dist/<anything>/index.js fallback
    join(here, '..', '..', 'src', 'templates', relPath),
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, 'utf8');
    } catch {}
  }
  throw new Error(`Template not found: ${relPath}`);
}

/**
 * Escapes a value for embedding inside a Ruby double-quoted string literal
 * that the template already wraps in literal `"..."`. Order matters:
 * backslashes must be doubled before quotes are escaped, or an escaped quote
 * would itself get re-escaped.
 *
 * Use with raw output (`<%- rubyString(x) %>`), never `<%= %>` — HTML-escaping
 * turns `&`/`'` into entities (`&amp;`, `&#39;`) which corrupts the Ruby
 * string instead of protecting it.
 */
export function rubyString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const RUBY_BARE_SYMBOL = /^[A-Za-z_][A-Za-z0-9_]*[?!=]?$/;

/**
 * Renders a Ruby symbol literal (e.g. for `lane <sym> do`). Bare form
 * (`:name`) when the value is already a safe identifier — byte-identical to
 * today's generated Fastfiles — quoted-symbol form (`:"name"`, a valid Ruby
 * literal) otherwise, with the same escaping as `rubyString`.
 */
export function rubySymbol(value: string): string {
  if (RUBY_BARE_SYMBOL.test(value)) return `:${value}`;
  return `:"${rubyString(value)}"`;
}

const YAML_UNSAFE_CHARS = /[:#[\]{}&*!|>'"%@`,\n\r\t]/;
const YAML_UNSAFE_LEADING = /^[\s\-?:,[\]{}#&*!|>'"%@`]/;
const YAML_RESERVED = /^(true|false|null|yes|no|on|off|~)$/i;
const YAML_NUMBER_LIKE = /^[-+]?(\d+(\.\d+)?|\.\d+)$/;

function needsYamlQuoting(value: string): boolean {
  if (value === '') return true;
  if (/^\s/.test(value) || /\s$/.test(value)) return true;
  if (YAML_UNSAFE_LEADING.test(value)) return true;
  if (YAML_UNSAFE_CHARS.test(value)) return true;
  if (YAML_RESERVED.test(value)) return true;
  if (YAML_NUMBER_LIKE.test(value)) return true;
  return false;
}

/**
 * Renders a value as a standalone YAML scalar: unquoted when it is safe as
 * plain-style YAML (byte-identical to today's output), single-quoted with
 * `''`-escaping otherwise (colons, quotes, `&`, leading/trailing whitespace,
 * reserved words, etc). Use with raw output (`<%- yamlScalar(x) %>`) for
 * values that are NOT already wrapped in literal quotes by the template.
 */
export function yamlScalar(value: string): string {
  if (!needsYamlQuoting(value)) return value;
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Escapes a value that will be embedded inside a single-quote pair the
 * template already writes literally (e.g. `- '<%- yamlSingleQuoted(x) %>'`).
 * Only doubles embedded single quotes, per YAML single-quoted scalar rules —
 * every other character (including `&` and `"`) is safe as-is.
 */
export function yamlSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

export function renderTemplate(relPath: string, data: Record<string, unknown>): string {
  const tpl = resolveTemplate(relPath);
  const helpers = { rubyString, rubySymbol, yamlScalar, yamlSingleQuoted };
  return ejs.render(tpl, { ...helpers, ...data }, { rmWhitespace: false });
}
