// SW-106: material para Google Play (política de privacidad pública + textos de la ficha y formularios).
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const r = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const html = r('frontend/privacidad.html');
assert.match(html, /<html lang="es"/);
for (const t of [/ubicaci[oó]n/i, /segundo plano/i, /correo electr[oó]nico/i, /identificador del dispositivo/i, /bater[ií]a/i,
  /no vendemos/i, /eliminaci[oó]n|eliminar/i, /mtitservices2005@gmail\.com/, /MT IT Services/, /Supabase/]) assert.match(html, t, `política menciona ${t}`);
assert.doesNotMatch(html, /<script[^>]+src=/i, 'la política no carga scripts externos');
assert.doesNotMatch(html, /lorem ipsum/i);

const vercel = JSON.parse(r('vercel.json'));
assert.ok(vercel.rewrites.some((x) => x.source === '/privacidad' && x.destination === '/privacidad.html'), 'rewrite /privacidad');

const docs = ['01-seguridad-de-los-datos', '02-ubicacion-en-segundo-plano', '03-ficha-de-la-tienda', '04-cuenta-de-revision', '05-lista-de-publicacion'];
for (const d of docs) assert.ok(existsSync(`docs/play-store/${d}.md`), `existe ${d}.md`);

const ficha = r('docs/play-store/03-ficha-de-la-tienda.md');
const grab = (label) => ficha.match(new RegExp(`\\*\\*${label}\\*\\*[^\\n]*\\n+> ([^\\n]+)`))?.[1] ?? '';
assert.ok(grab('Nombre de la app').length > 0 && grab('Nombre de la app').length <= 30, 'título ≤ 30');
assert.ok(grab('Descripción corta').length > 0 && grab('Descripción corta').length <= 80, 'descripción corta ≤ 80');
assert.ok(ficha.length < 12000);
assert.match(r('docs/play-store/02-ubicacion-en-segundo-plano.md'), /SmartWaste est[aá] registrando tu recorrido/);
assert.doesNotMatch(docs.map((d) => r(`docs/play-store/${d}.md`)).join('\n'), /(password|contraseña)\s*[:=]\s*\S{4,}/i, 'sin contraseñas en los documentos');
console.log('sw106-play-store OK');
