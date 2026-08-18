// SW-040: build step for static hosting (Vercel and similar) — copies frontend/ into dist/ and
// injects SMARTWASTE_SUPABASE_CONFIG from environment variables (set in the hosting provider's
// dashboard, never committed to git — the anon key is meant to be public per CLAUDE.md rule 8, but
// which specific project a deployment points at shouldn't live in source control either).
//
// Reuses the exact same <!-- SMARTWASTE_SUPABASE_CONFIG:START/END --> marker convention already
// established by scripts/seed-local.mjs and scripts/seed-empty-municipality.mjs, so all three
// injection points stay consistent and none of them fight over the same block.
//
// SUPABASE_URL/SUPABASE_ANON_KEY are optional on purpose: if they're not set (e.g. a preview
// deploy without secrets configured), this still produces a working dist/ — just demo-only, same
// as opening frontend/index.html locally with no config (rule 5, never break the demo). Only warns
// loudly, never fails the build, so a misconfigured env doesn't take down a deploy that was only
// ever meant to show the demo.
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FRONTEND_DIR = fileURLToPath(new URL('../frontend', import.meta.url));
const DIST_DIR = fileURLToPath(new URL('../dist', import.meta.url));
const INDEX_HTML_PATH = fileURLToPath(new URL('../dist/index.html', import.meta.url));
const CONFIG_START = '<!-- SMARTWASTE_SUPABASE_CONFIG:START (generado por scripts/build-frontend-config.mjs) -->';
const CONFIG_END = '<!-- SMARTWASTE_SUPABASE_CONFIG:END -->';

function stripPreviousConfigBlock(html) {
  const startIndex = html.indexOf('<!-- SMARTWASTE_SUPABASE_CONFIG:START');
  if (startIndex === -1) return html;
  const endIndex = html.indexOf(CONFIG_END, startIndex);
  if (endIndex === -1) return html;
  const afterEnd = endIndex + CONFIG_END.length;
  return html.slice(0, startIndex) + html.slice(afterEnd).replace(/^\n/, '');
}

function writeSupabaseConfigIntoIndexHtml({ url, anonKey, municipality_id }) {
  const html = readFileSync(INDEX_HTML_PATH, 'utf8');
  const configBlock = `${CONFIG_START}
  <script>
    window.SMARTWASTE_SUPABASE_CONFIG = ${JSON.stringify({ url, anonKey, municipality_id: municipality_id || null })};
  </script>
  ${CONFIG_END}
`;
  const withoutOldBlock = stripPreviousConfigBlock(html);
  const updated = withoutOldBlock.includes('<script type="module" src="./app.js">')
    ? withoutOldBlock.replace('<script type="module" src="./app.js">', `${configBlock}  <script type="module" src="./app.js">`)
    : withoutOldBlock;
  writeFileSync(INDEX_HTML_PATH, updated);
}

mkdirSync(DIST_DIR, { recursive: true });
cpSync(FRONTEND_DIR, DIST_DIR, { recursive: true });

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  console.warn('\n⚠️  SUPABASE_URL/SUPABASE_ANON_KEY no configuradas — dist/ queda en modo demo puro (sin backend real). Configuralas en las variables de entorno del hosting si esta build es para staging real.\n');
} else {
  writeSupabaseConfigIntoIndexHtml({ url, anonKey, municipality_id: process.env.SUPABASE_MUNICIPALITY_ID });
  console.log(`\ndist/index.html generado con SMARTWASTE_SUPABASE_CONFIG apuntando a ${url}${process.env.SUPABASE_MUNICIPALITY_ID ? ` (municipality_id: ${process.env.SUPABASE_MUNICIPALITY_ID})` : ' (sin municipality_id — el portal ciudadano seguirá en modo demo)'}.\n`);
}
