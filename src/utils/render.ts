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

export function renderTemplate(relPath: string, data: Record<string, unknown>): string {
  const tpl = resolveTemplate(relPath);
  return ejs.render(tpl, data, { rmWhitespace: false });
}
