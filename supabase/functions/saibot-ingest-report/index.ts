// SW-127: recibe reportes de basura acumulada enviados por Saibot. Se autentica con la clave del ayuntamiento
// (X-SmartWaste-Key), no con una sesión de usuario; service_role queda solo en esta función.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createSaibotIngestHandler } from './handler.js';

Deno.serve(createSaibotIngestHandler({ createClient, env: Deno.env }));
