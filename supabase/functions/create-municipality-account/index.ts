// SW-061: platform-only onboarding of a municipality and its first municipal administrator.
// The caller is identified with their own JWT; service_role remains only in the Edge Function.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createMunicipalityAccountHandler } from './handler.js';

Deno.serve(createMunicipalityAccountHandler({ createClient, env: Deno.env }));
