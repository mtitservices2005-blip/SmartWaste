// SW-133: acceso del conductor sin internet. Se guarda quién entró (sin contraseña ni tokens) y solo se reabre
// la app del conductor sin red mientras ese acceso sea reciente. Lógica pura, sin red.
import assert from 'node:assert/strict';
import { createDriverAccessStore, decideOfflineAccess, OFFLINE_ACCESS_MAX_DAYS } from '../shared/driver-offline-access.js';

const mem = () => { const m = new Map(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; };
const DAY = 86_400_000;
const T0 = new Date('2026-11-21T12:00:00Z');
const at = (days) => new Date(T0.getTime() + days * DAY);
const user = { id: 'u1', email: 'Carlos@Ejemplo.do' };
const ctx = { user_id: 'u1', role: 'driver', municipality_id: 'm1', profile: { secret: 'x' }, membership: { y: 1 } };

assert.equal(OFFLINE_ACCESS_MAX_DAYS, 7);

// guardar / cargar / borrar
const st = mem(); const store = createDriverAccessStore({ storage: st, now: () => T0 });
assert.equal(await store.load(), null);
assert.equal(await store.save({ user, ctx }), true);
const rec = await store.load();
assert.deepEqual(rec, { userId: 'u1', email: 'carlos@ejemplo.do', role: 'driver', municipalityId: 'm1', verifiedAt: T0.toISOString() });
const raw = [...st.m.values()].join('');
assert.ok(!/secret|membership|password|token/i.test(raw), 'no se guardan datos del perfil, contraseña ni tokens');
await store.clear(); assert.equal(await store.load(), null);

// solo conductores
assert.equal(await store.save({ user, ctx: { ...ctx, role: 'municipal_admin' } }), false);
assert.equal(await store.save({ user, ctx: { ...ctx, user_id: 'otro' } }), false, 'el contexto debe ser del mismo usuario');
assert.equal(await store.save({ user: {}, ctx }), false);
assert.equal(await store.load(), null);

// JSON dañado o almacenamiento que falla
const bad = mem(); bad.setItem('smartwaste.driver-access.v1', '{roto');
assert.equal(await createDriverAccessStore({ storage: bad }).load(), null);
const boom = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
assert.equal(await createDriverAccessStore({ storage: boom }).save({ user, ctx }), false);

// decisión
await store.save({ user, ctx });
const stored = await store.load();
let d = decideOfflineAccess({ stored, now: at(1) });
assert.deepEqual(d, { allowed: true, reason: 'ok', ctx: { user_id: 'u1', role: 'driver', municipality_id: 'm1' }, email: 'carlos@ejemplo.do' });
assert.equal(decideOfflineAccess({ stored, now: at(7) }).allowed, true, 'justo 7 días: aún vale');
assert.deepEqual([decideOfflineAccess({ stored, now: at(7.01) }).allowed, decideOfflineAccess({ stored, now: at(7.01) }).reason], [false, 'vencido']);
assert.equal(decideOfflineAccess({ stored: null, now: T0 }).reason, 'sin-registro');
assert.equal(decideOfflineAccess({ stored: { ...stored, role: 'dispatcher' }, now: T0 }).reason, 'rol');
assert.equal(decideOfflineAccess({ stored: { ...stored, verifiedAt: 'basura' }, now: T0 }).reason, 'fecha');
assert.equal(decideOfflineAccess({ stored: { ...stored, verifiedAt: at(2).toISOString() }, now: T0 }).reason, 'fecha', 'fecha futura: reloj movido');
assert.equal(decideOfflineAccess({ stored: { ...stored, userId: '' }, now: T0 }).allowed, false);
assert.equal(decideOfflineAccess({ stored: { ...stored, municipalityId: null }, now: T0 }).allowed, false);
assert.equal(decideOfflineAccess({ stored, now: at(5), maxDays: 3 }).reason, 'vencido', 'el límite se puede cambiar');
console.log('driver-offline-access: ok');
