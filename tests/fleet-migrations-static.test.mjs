// SW-081: guardas estáticas sobre las migraciones nuevas y el workflow de CI. SCOPE: lee texto, NO
// se conecta a una base de datos (el comportamiento real lo prueban tests/fleet-*.test.mjs de
// integración). Protege contra: migraciones destructivas, tablas nuevas sin RLS ni políticas,
// retención fija en el código (decisión del 2026-10-13: configurable) y pruebas de integración
// que no quedan registradas en tests.yml.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const dir = 'supabase/migrations';
const files = readdirSync(dir).filter((f) => /^2026101200\d\d_sw081_.*\.sql$/.test(f)).sort();
assert.ok(files.length >= 2, `se esperan al menos 2 migraciones sw081, hay ${files.length}`);
const sqlOf = (f) => readFileSync(`${dir}/${f}`, 'utf8');
const all = files.map(sqlOf).join('\n');

// Solo aditivas.
for (const f of files) {
  const sql = sqlOf(f).replace(/--.*$/gm, '');
  assert.doesNotMatch(sql, /\bdrop\s+(table|column|schema|function)\b/i, `${f}: migración no aditiva`);
  assert.doesNotMatch(sql, /\btruncate\b/i, `${f}: no truncar`);
  assert.doesNotMatch(sql, /\balter\s+table\s+\S+\s+(drop|rename|alter\s+column)\b/i, `${f}: no alterar columnas existentes`);
  assert.doesNotMatch(sql, /\balter\s+(policy|table\s+\S+\s+disable\s+row)/i, `${f}: no relajar RLS`);
  assert.doesNotMatch(sql, /\bdrop\s+policy\b(?![^;]*\b(fleet_|vehicle_live_state|fuel_logs))/i, `${f}: no tocar políticas existentes`);
  assert.doesNotMatch(sql, /eyJ[A-Za-z0-9_-]{20,}/, `${f}: parece contener un token`);
}

// Toda tabla nueva: RLS activada y al menos una política.
for (const match of all.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)/gi)) {
  const t = match[1];
  assert.match(all, new RegExp(`alter\\s+table\\s+(?:public\\.)?${t}\\s+enable\\s+row\\s+level\\s+security`, 'i'), `${t}: falta enable row level security`);
  assert.match(all, new RegExp(`create\\s+policy\\s+\\w+\\s+on\\s+(?:public\\.)?${t}\\b`, 'i'), `${t}: falta al menos una política`);
}
for (const t of ['vehicle_live_state', 'fleet_alerts', 'fuel_logs', 'fleet_settings']) assert.match(all, new RegExp(`create\\s+table[^;]*\\b${t}\\b`, 'i'), `falta la tabla ${t}`);
assert.match(all, /battery_pct\s+smallint/i);
for (const fn of ['ingest_positions', 'fleet_overview', 'derive_vehicle_status', 'refresh_fleet_alerts', 'acknowledge_fleet_alert', 'purge_old_positions']) {
  assert.match(all, new RegExp(`create\\s+or\\s+replace\\s+function\\s+${fn}\\b`, 'i'), `falta la función ${fn}`);
  assert.match(all, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${fn}\\b[^;]*from\\s+public`, 'i'), `${fn}: falta revoke ... from public`);
}

// La retención no es un número fijo en el código (aprobado 2026-10-13: 180 días, configurable).
const purge = all.match(/function\s+purge_old_positions[\s\S]*?\$\$([\s\S]*?)\$\$/i);
assert.ok(purge, 'no se encontró el cuerpo de purge_old_positions');
assert.doesNotMatch(purge[1], /\b(90|180)\b/, 'purge_old_positions no debe llevar la retención escrita en el código');
assert.match(all, /gps_retention_days[\s\S]*?180/i, 'la configuración por defecto de 180 días debe sembrarse como dato');

// CI: cada prueba de integración de flotilla está fuera del job unitario y dentro del de integración.
const workflow = readFileSync('.github/workflows/tests.yml', 'utf8');
const skipLine = workflow.match(/skip_list="([^"]*)"/)?.[1] ?? '';
const integrationJob = workflow.slice(workflow.indexOf('integration-tests:'));
for (const f of readdirSync('tests').filter((n) => /^fleet-.*\.test\.mjs$/.test(n))) {
  const isIntegration = /from '\.\/integration\/fleet-db\.mjs'/.test(readFileSync(`tests/${f}`, 'utf8'));
  assert.equal(skipLine.includes(`tests/${f}`), isIntegration, `${f}: ${isIntegration ? 'debe estar' : 'no debe estar'} en la lista de exclusión del job unitario`);
  assert.equal(integrationJob.includes(`node tests/${f}`), isIntegration, `${f}: ${isIntegration ? 'debe correr' : 'no debe correr'} en el job de integración`);
}

console.log('fleet-migrations-static ok');
