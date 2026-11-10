// SW-117: revisión estática de la migración de licencias (las pruebas contra la base real se hacen en staging).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WARN_DAYS, GRACE_DAYS_DEFAULT, MAX_TRUCKS_PER_CHANGE } from '../shared/license.js';

const sql = readFileSync('supabase/migrations/202611080001_sw117_licencias.sql', 'utf8');
const has = (re, msg) => assert.match(sql, re, msg);

// Tablas con RLS y sin acceso anónimo
has(/create table if not exists municipality_licenses/); has(/create table if not exists license_events/);
has(/alter table municipality_licenses enable row level security/); has(/alter table license_events enable row level security/);
has(/revoke all on municipality_licenses, license_events from anon/);
has(/municipality_id uuid primary key references municipalities\(id\)/, 'una licencia por ayuntamiento');
has(/currency text not null default 'USD' check \(currency in \('USD','DOP'\)\)/);
has(/billing_mode text not null default 'manual' check \(billing_mode in \('manual','automatic'\)\)/);
has(/price_per_truck_year numeric\(12,2\) not null default 0 check \(price_per_truck_year >= 0\)/);

// El administrador solo lee; Master Admin escribe
has(/create policy license_read on municipality_licenses for select\s+using \(has_municipality_role\(municipality_id, array\['municipal_admin','supervisor','dispatcher'\]\)\)/);
has(/create policy license_write_superadmin on municipality_licenses for all\s+using \(has_platform_role\('mt_superadmin'\)\) with check \(has_platform_role\('mt_superadmin'\)\)/);
has(/create policy license_events_read on license_events for select\s+using \(has_municipality_role\(municipality_id, array\['municipal_admin'\]\)\)/);
assert.ok(!/for (insert|update|delete) .*municipal_admin/.test(sql), 'ninguna política de escritura para el administrador');
assert.ok(!/service_role/.test(sql));

// Funciones sensibles: security definer con search_path fijo, sin ejecución anónima
for (const fn of ['enforce_license', 'add_licensed_trucks', 'register_license_payment', 'set_license_suspended']) {
  assert.match(sql, new RegExp(`create or replace function ${fn}\\([^]*?security definer set search_path = public`), `${fn} security definer con search_path`);
}
for (const sig of ['add_licensed_trucks(uuid, integer)', 'register_license_payment(uuid, numeric, text, text)', 'set_license_suspended(uuid, boolean)']) {
  assert.ok(sql.includes(`revoke all on function ${sig} from public, anon`), `sin acceso anónimo a ${sig}`);
  assert.ok(sql.includes(`grant execute on function ${sig} to authenticated`));
}
has(/if auth\.uid\(\) is null then raise exception 'license_forbidden'/);
has(/has_municipality_role\(p_municipality_id, array\['municipal_admin'\]\)/, 'solo el administrador de ese ayuntamiento suma camiones');
assert.equal((sql.match(/if not has_platform_role\('mt_superadmin'\) then raise exception 'license_forbidden'/g) ?? []).length, 2, 'pagos y suspensión: solo Master Admin');
has(new RegExp(`p_trucks < 1 or p_trucks > ${MAX_TRUCKS_PER_CHANGE}`));

assert.ok(sql.includes('revoke all on function enforce_license() from public, anon, authenticated'), 'el trigger no se llama como RPC');
// Bloqueos en vehículos, rutas y conductores; nunca en la app del chofer (corridas, posiciones)
for (const t of ['vehicles', 'routes', 'drivers']) has(new RegExp(`create trigger sw117_license_${t} before insert on ${t} for each row execute function enforce_license\\(\\)`));
assert.ok(!/trigger[^;]*on (route_runs|vehicle_positions|fuel_logs)/.test(sql), 'la licencia no bloquea corridas ni GPS');
has(/raise exception 'license_truck_limit/); has(/raise exception 'license_suspended'/);
has(/if not found then return new; end if;/, 'sin licencia no hay límites');

// Mismos umbrales que shared/license.js
has(new RegExp(`\\(p_valid_until - current_date\\) <= ${WARN_DAYS} then 'por_vencer'`));
has(new RegExp(`coalesce\\(p_grace_days, ${GRACE_DAYS_DEFAULT}\\)`));
has(/grace_days integer not null default 15 check \(grace_days between 0 and 90\)/);
has(/when p_suspended then 'suspendido'/); has(/< 0 then 'vencido'/); has(/when p_is_trial then 'prueba'/);

// Cargo proporcional: sin cargo en prueba, vencida o sin tarifa
has(/if lic\.is_trial or days <= 0 or lic\.price_per_truck_year <= 0 then amt := null;/);
has(/round\(p_trucks \* lic\.price_per_truck_year \* least\(days, 365\) \/ 365\.0, 2\)/);
console.log('sw117-licencia-migracion ok');
