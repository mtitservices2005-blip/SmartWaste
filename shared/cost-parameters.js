// SW-030: cost parameters for the Centro de Impacto y Ahorros — before this hito, every assumption
// shared/impact-center.js's calculateImpactMetrics() used (fuelPrice, fuelEfficiency, etc.) was a
// hardcoded constant (defaultImpactAssumptions) that reset on every page load; nothing persisted a
// municipality's own values. Persisted in the existing `municipality_settings` table (one row per
// municipality, a `settings` jsonb column — supabase/migrations/202607150001_sw007_foundation.sql),
// under the `cost_parameters` key, rather than a new table: that table already exists exactly for
// this ("per-municipality settings blob"), already has RLS (tenant_read/tenant_insert_staff/
// tenant_update_staff, 202607150004_sw014_auth_rls_policies.sql) that gives a municipality's own
// staff (municipal_admin/supervisor/dispatcher) read+write on their own municipality_id only, and
// gives mt_superadmin (Master Admin) read+write on every municipality via
// has_municipality_role()'s platform-role bypass — exactly the isolation this hito needs, with no
// new migration required.

// Every numeric assumption shared/impact-center.js's calculateImpactMetrics() already reads —
// mirrors defaultImpactAssumptions there field-for-field (see that file for what each feeds into),
// except currentDistanceKm, which stays derived from real route data, never a configured input.
export const DEFAULT_COST_PARAMETERS = {
  fuelPrice: 76,
  fuelEfficiency: 4.8,
  operatingDays: 22,
  hourlyCost: 950,
  baseDistanceKm: 31,
  baselineOperatingHours: 7.4,
  operatingHours: 6.1,
  incidentAvoidanceCost: 1200,
  minutesPerStop: 1,
  avgSpeedKmh: 18
};

export const COST_PARAMETER_KEYS = Object.keys(DEFAULT_COST_PARAMETERS);

// fuelEfficiency and avgSpeedKmh are divisors in calculateImpactMetrics() (fuelSavedLiters =
// avoidedKm / fuelEfficiency; travelMinutes = distanceKm / avgSpeedKmh * 60) — zero or negative
// there is not just wrong, it produces Infinity/NaN or a flipped sign throughout the panel. Every
// other field is only ever multiplied, so zero is a legitimate (if unusual) value for those.
const POSITIVE_REQUIRED_KEYS = ['fuelEfficiency', 'avgSpeedKmh'];

// Validates a full parameter set before it's saved — every key must be present and a sane number.
// Used at save time only; reading/merging partial or missing data is mergeCostParameters()'s job
// (below), which is deliberately lenient (a municipality that hasn't configured anything yet must
// still get a usable, if estimated, set of values).
export function validateCostParameters(params) {
  const errors = [];
  if (!params || typeof params !== 'object') return { valid: false, errors: ['Parámetros inválidos.'] };
  for (const key of COST_PARAMETER_KEYS) {
    const raw = params[key];
    if (raw === undefined || raw === null || raw === '') { errors.push(`Falta el parámetro ${key}.`); continue; }
    const value = Number(raw);
    if (!Number.isFinite(value)) { errors.push(`${key} debe ser un número.`); continue; }
    if (value < 0) errors.push(`${key} no puede ser negativo.`);
    if (POSITIVE_REQUIRED_KEYS.includes(key) && value <= 0) errors.push(`${key} debe ser mayor a cero.`);
  }
  return { valid: errors.length === 0, errors };
}

// Merges whatever a municipality has saved (possibly nothing, possibly a partial/old record) with
// the defaults — a missing/invalid field falls back to its default rather than breaking the whole
// panel. `configured` distinguishes "nothing saved yet, showing estimated defaults" (the UI badges
// this per the fase's requirement) from "these are the municipality's own saved values", even when
// a saved value happens to equal a default.
export function mergeCostParameters(overrides) {
  const values = { ...DEFAULT_COST_PARAMETERS };
  let configured = false;
  if (overrides && typeof overrides === 'object') {
    for (const key of COST_PARAMETER_KEYS) {
      const raw = overrides[key];
      if (raw === undefined || raw === null || raw === '') continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      values[key] = value;
      configured = true;
    }
  }
  return { values, configured };
}

// Real adapter — reads a municipality's cost_parameters from municipality_settings.settings. No
// demo fallback here (mirrors shared/operations-adapter.js's findOwnVehicleAssignment()): the demo
// path uses createDemoCostParametersStore() below instead, a distinct in-memory concern, not a
// fallback baked into this function.
export async function fetchCostParameters(client, municipality_id, opts = {}) {
  if (!client?.from) return { ok: false, error: { code: 'SUPABASE_CLIENT_MISSING', message: 'No hay backend real configurado.' } };
  if (!municipality_id) return { ok: false, error: { code: 'NO_MUNICIPALITY', message: 'Falta municipality_id.' } };
  const result = await client.from('municipality_settings').select('settings').eq('municipality_id', municipality_id).maybeSingle();
  if (result.error) return { ok: false, error: { code: result.error.code ?? 'SUPABASE_ERROR', message: result.error.message }, correlation_id: opts.correlation_id };
  const { values, configured } = mergeCostParameters(result.data?.settings?.cost_parameters);
  return { ok: true, values, configured, correlation_id: opts.correlation_id };
}

// Read-modify-write: `settings` is a shared jsonb blob (municipality_settings has exactly one row
// per municipality, unique constraint — 202607150003_sw013_persistence_hardening.sql), so a blind
// overwrite would erase any other key some other feature stores there. Validates before writing —
// an invalid save is rejected outright, never partially applied.
export async function saveCostParameters(client, municipality_id, params, opts = {}) {
  if (!client?.from) return { ok: false, error: { code: 'SUPABASE_CLIENT_MISSING', message: 'No hay backend real configurado.' } };
  if (!municipality_id) return { ok: false, error: { code: 'NO_MUNICIPALITY', message: 'Falta municipality_id.' } };
  const validation = validateCostParameters(params);
  if (!validation.valid) return { ok: false, error: { code: 'INVALID_COST_PARAMETERS', message: validation.errors.join(' ') } };
  const numericParams = Object.fromEntries(COST_PARAMETER_KEYS.map((key) => [key, Number(params[key])]));
  const existing = await client.from('municipality_settings').select('id, settings').eq('municipality_id', municipality_id).maybeSingle();
  if (existing.error) return { ok: false, error: { code: existing.error.code ?? 'SUPABASE_ERROR', message: existing.error.message } };
  const nextSettings = { ...(existing.data?.settings ?? {}), cost_parameters: numericParams };
  const write = existing.data
    ? await client.from('municipality_settings').update({ settings: nextSettings }).eq('id', existing.data.id).select('settings').single()
    : await client.from('municipality_settings').insert({ municipality_id, settings: nextSettings }).select('settings').single();
  if (write.error) return { ok: false, error: { code: write.error.code ?? 'SUPABASE_ERROR', message: write.error.message } };
  const { values } = mergeCostParameters(write.data.settings.cost_parameters);
  return { ok: true, values, correlation_id: opts.correlation_id };
}

// Demo-mode stand-in — keyed by municipality_id so both demo municipalities (shared/demo-data.js's
// `municipalities`, e.g. 'laguna-salada-rd' and 'mun-norte') can be edited independently from
// Master Admin's municipality picker without touching Supabase. Mirrors the get/save shape of the
// functions above so frontend/app.js can call either path without branching on every call site.
export function createDemoCostParametersStore() {
  const store = new Map();
  return {
    get(municipality_id) {
      const { values, configured } = mergeCostParameters(store.get(municipality_id));
      return { ok: true, values, configured };
    },
    save(municipality_id, params) {
      const validation = validateCostParameters(params);
      if (!validation.valid) return { ok: false, error: { code: 'INVALID_COST_PARAMETERS', message: validation.errors.join(' ') } };
      const numericParams = Object.fromEntries(COST_PARAMETER_KEYS.map((key) => [key, Number(params[key])]));
      store.set(municipality_id, numericParams);
      const { values } = mergeCostParameters(numericParams);
      return { ok: true, values };
    }
  };
}
