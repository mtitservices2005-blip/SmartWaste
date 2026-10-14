// SW-083: configuración de Supabase que se incrusta en el paquete móvil. Módulo puro para poder probarlo.
//  - Sin variables y sin modo estricto: devuelve null (paquete demo, como antes).
//  - Con SMARTWASTE_REQUIRE_BACKEND=true (build de lanzamiento): SUPABASE_URL y SUPABASE_ANON_KEY son
//    obligatorias y la URL debe ser https; si falta algo el build falla con un mensaje claro.
export function resolveBackendConfig(env = process.env) {
  const url = (env.SUPABASE_URL ?? '').trim();
  const anonKey = (env.SUPABASE_ANON_KEY ?? '').trim();
  const strict = env.SMARTWASTE_REQUIRE_BACKEND === 'true';

  if (strict && (!url || !anonKey)) {
    throw new Error('SMARTWASTE_REQUIRE_BACKEND=true: SUPABASE_URL y SUPABASE_ANON_KEY son obligatorias para un APK de lanzamiento.');
  }
  if (!url && !anonKey) return null;
  if (!url || !anonKey) throw new Error('SUPABASE_URL y SUPABASE_ANON_KEY deben indicarse juntas.');
  if (strict && !/^https:\/\//i.test(url)) throw new Error('SUPABASE_URL debe empezar con https:// en un APK de lanzamiento.');

  return {
    url,
    anonKey,
    municipality_id: env.SUPABASE_MUNICIPALITY_ID || null,
    hideDemo: env.SUPABASE_HIDE_DEMO === 'true'
  };
}
