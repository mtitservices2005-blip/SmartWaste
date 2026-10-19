-- SW-100: el Portal ciudadano ya conoce el municipality_id del despliegue (config), no su slug.
-- Esta función reutiliza public_live_fleet(slug): resuelve el slug del municipio (activo/en onboarding) y delega.
-- Mismo contrato y mismos datos mínimos; no abre tablas ni policies.
create or replace function public.public_live_fleet(p_municipality_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return public.public_live_fleet(
    (select m.slug
       from municipalities m
      where m.id = p_municipality_id
        and m.status in ('active', 'onboarding')
      limit 1)
  );
end;
$$;

revoke all on function public.public_live_fleet(uuid) from public;
grant execute on function public.public_live_fleet(uuid) to anon, authenticated;
