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

// SW-108: URL del version.json que la app consulta para avisar de una versión nueva. Opcional: sin la variable
// (o con una URL que no sea https) no se incrusta nada y la app simplemente no busca actualizaciones.
export function resolveUpdateManifestUrl(env = process.env) {
  const base = (env.SMARTWASTE_UPDATE_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (!base) return null;
  if (!/^https:\/\/[^\s/]+/i.test(base)) throw new Error('SMARTWASTE_UPDATE_BASE_URL debe empezar con https:// (ejemplo: https://tu-sitio.vercel.app).');
  return `${base}/downloads/version.json`;
}
