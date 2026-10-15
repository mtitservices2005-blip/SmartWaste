-- SW-087: teléfono del conductor. Aditiva y opcional; no cambia ninguna política RLS.
alter table drivers add column if not exists phone text;

comment on column drivers.phone is 'Teléfono de contacto del conductor. Opcional.';
