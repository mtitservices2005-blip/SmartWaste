-- SW-132: una cuenta maneja un solo ayuntamiento. Cada ayuntamiento se maneja de forma independiente.
-- Una persona no puede tener dos membresías activas; para cambiar de ayuntamiento se desactiva la anterior.
create unique index if not exists memberships_one_active_per_profile_idx on memberships (profile_id) where status = 'active';
