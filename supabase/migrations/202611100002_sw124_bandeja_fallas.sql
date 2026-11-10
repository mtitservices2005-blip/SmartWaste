-- SW-124: bandeja de fallas del administrador.
-- El estado de una falla solo cambia por update_vehicle_defect_status(): valida el recorrido
-- (reportada → en revisión → corregida → verificada) y deja quién y cuándo. Se quita el UPDATE directo de SW-123
-- para que nadie pueda cambiar la gravedad, el camión o saltarse pasos.

drop policy if exists defects_update_staff on vehicle_defects;

create or replace function update_vehicle_defect_status(p_defect_id uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d vehicle_defects;
  ok boolean;
begin
  if auth.uid() is null then raise exception 'defect_not_allowed'; end if;
  select * into d from vehicle_defects where id = p_defect_id for update;
  if not found then raise exception 'defect_not_found'; end if;
  if not has_municipality_role(d.municipality_id, array['municipal_admin','supervisor']) then raise exception 'defect_not_allowed'; end if;
  if p_status not in ('reported','in_review','fixed','verified') then raise exception 'defect_invalid'; end if;
  if p_note is not null and char_length(p_note) > 300 then raise exception 'defect_invalid'; end if;

  ok := (d.status = 'reported' and p_status in ('in_review','fixed'))
     or (d.status = 'in_review' and p_status in ('reported','fixed'))
     or (d.status = 'fixed' and p_status in ('in_review','verified'));
  if not ok then raise exception 'defect_transition'; end if;

  update vehicle_defects set
    status = p_status,
    resolved_by = case when p_status = 'fixed' then auth.uid() else resolved_by end,
    resolved_at = case when p_status = 'fixed' then now() else resolved_at end,
    resolution_note = case when p_status in ('fixed','in_review') and nullif(trim(p_note), '') is not null then trim(p_note) else resolution_note end,
    verified_by = case when p_status = 'verified' then auth.uid() else verified_by end,
    verified_at = case when p_status = 'verified' then now() else verified_at end
  where id = d.id;

  return jsonb_build_object('id', d.id, 'status', p_status);
end $$;
revoke all on function update_vehicle_defect_status(uuid, text, text) from public, anon;
grant execute on function update_vehicle_defect_status(uuid, text, text) to authenticated;
