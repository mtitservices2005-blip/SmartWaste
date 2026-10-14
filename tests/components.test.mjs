// SW-082 (CA-082-2, CA-082-3): componentes base del sistema de diseño. Son funciones puras que
// devuelven HTML (como el resto de frontend/app.js, que arma cadenas), así que se prueban sin DOM.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { escapeHtml, button } from '../frontend/components/button.js';
import { badge, STATUS_META } from '../frontend/components/badge.js';
import { field } from '../frontend/components/field.js';
import { toastHtml, toast } from '../frontend/components/toast.js';
import { emptyState } from '../frontend/components/empty-state.js';
import { statusCard } from '../frontend/components/status-card.js';
import { dataTable } from '../frontend/components/data-table.js';
import { skeleton } from '../frontend/components/skeleton.js';
import { parseTokens } from '../scripts/check-contrast.mjs';

// Escapado: ningún texto del usuario entra como HTML.
assert.equal(escapeHtml(`<img src=x onerror="a">&'`), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');

// Botón: variantes, tipo por defecto "button" (no envía formularios por accidente) y escapado.
assert.match(button({ label: 'Iniciar recorrido' }), /^<button type="button" class="sw-btn sw-btn--primary">Iniciar recorrido<\/button>$/);
assert.match(button({ label: 'Cancelar', variant: 'secondary' }), /sw-btn--secondary/);
assert.match(button({ label: 'Eliminar', variant: 'danger', id: 'del' }), /id="del"[^>]*sw-btn--danger|sw-btn--danger[^>]*id="del"/);
assert.match(button({ label: '<b>x</b>' }), /&lt;b&gt;x&lt;\/b&gt;/);
assert.throws(() => button({ label: 'x', variant: 'rosa' }), /variante/i);
assert.throws(() => button({ variant: 'primary' }), /label/i, 'un botón sin texto es inaccesible');

// Insignia: SIEMPRE icono + texto + color (clase), nunca solo color.
for (const status of Object.keys(STATUS_META)) {
  const html = badge({ status });
  assert.match(html, new RegExp(`sw-badge--${status}`), `${status}: clase de color`);
  assert.match(html, /class="sw-badge__icon" aria-hidden="true">[^<]+</, `${status}: icono`);
  assert.match(html, /class="sw-badge__text">[^<]+</, `${status}: texto`);
}
assert.deepEqual(Object.keys(STATUS_META), ['en-ruta', 'detenido', 'sin-senal', 'disponible', 'fuera-servicio']);
assert.match(badge({ status: 'sin-senal' }), />Sin señal</);
assert.match(badge({ status: 'en-ruta', label: 'Unidad 3 en ruta' }), />Unidad 3 en ruta</);
assert.throws(() => badge({ status: 'volando' }), /estado/i);

// CA-082-3: ningún campo depende solo de un placeholder: etiqueta visible con for=id y ayuda enlazada.
{
  const html = field({ id: 'plate', label: 'Matrícula', hint: 'Como aparece en el camión', value: 'A123456', required: true });
  assert.match(html, /<label class="sw-field__label" for="plate">Matrícula/);
  assert.match(html, /<input[^>]* id="plate"/);
  assert.match(html, /aria-describedby="plate-hint"/);
  assert.match(html, /id="plate-hint"[^>]*>Como aparece en el camión</);
  assert.match(html, /required/);
  assert.match(html, /value="A123456"/);
  assert.doesNotMatch(html, /placeholder=/, 'el placeholder no reemplaza a la etiqueta');
  assert.throws(() => field({ id: 'x' }), /label/i);
  assert.throws(() => field({ label: 'Sin id' }), /id/i);
  assert.match(field({ id: 'n', label: 'Teléfono', error: 'Escribe solo números, por ejemplo 8095551234' }), /role="alert"[^>]*>Escribe solo números/);
  const select = field({ id: 'sec', label: 'Sector', type: 'select', options: [{ value: 'a', label: 'Centro' }, { value: 'b', label: 'Norte' }], value: 'b' });
  assert.match(select, /<select[^>]* id="sec"/);
  assert.match(select, /<option value="b" selected>Norte</);
  assert.match(field({ id: 'a', label: '<script>' }), /&lt;script&gt;/);
}

// Aviso (toast): rol según el tono y render aunque no haya DOM.
assert.match(toastHtml({ message: 'Guardado', tone: 'success' }), /role="status"[^>]*sw-toast--success|sw-toast--success[^>]*role="status"/);
assert.match(toastHtml({ message: 'No se pudo guardar. Revisa tu conexión y vuelve a intentar.', tone: 'error' }), /role="alert"/);
assert.throws(() => toastHtml({ message: 'x', tone: 'morado' }), /tono/i);
{
  const appended = [];
  const fakeDoc = { getElementById: () => null, createElement: () => ({ set innerHTML(v) { this.html = v; }, get firstElementChild() { return { html: this.html, remove() {} }; }, appendChild() {} }), body: { appendChild: (el) => appended.push(el) } };
  assert.doesNotThrow(() => toast({ message: 'Hola', tone: 'info' }, { document: undefined }), 'sin DOM no falla');
  toast({ message: 'Hola', tone: 'info', duration: 0 }, { document: fakeDoc });
  assert.equal(appended.length >= 1, true, 'con DOM agrega el aviso al documento');
}

// Estado vacío: dice qué pasa y qué hacer.
{
  const html = emptyState({ title: 'Todavía no hay camiones', message: 'Agrega el primer camión para empezar.', actionLabel: 'Agregar camión', actionId: 'addTruck' });
  assert.match(html, /sw-empty/);
  assert.match(html, /Todavía no hay camiones/);
  assert.match(html, /id="addTruck"[^>]*>Agregar camión</);
  assert.doesNotMatch(emptyState({ title: 'Sin alertas' }), /<button/, 'sin acción no hay botón');
  assert.throws(() => emptyState({}), /title/i);
}

// Tarjeta de estado: título, valor, insignia opcional.
{
  const html = statusCard({ title: 'Camiones en ruta', value: '4 de 5', status: 'en-ruta', note: 'Última señal hace 12 s' });
  assert.match(html, /sw-status-card/);
  assert.match(html, /Camiones en ruta/);
  assert.match(html, /4 de 5/);
  assert.match(html, /sw-badge--en-ruta/);
  assert.match(html, /Última señal hace 12 s/);
}

// Tabla: encabezados con scope, caption para lectores de pantalla y mensaje cuando no hay filas.
{
  const html = dataTable({ caption: 'Camiones', columns: [{ key: 'unit', label: 'Unidad' }, { key: 'status', label: 'Estado', html: true }], rows: [{ unit: 'C-01', status: badge({ status: 'en-ruta' }) }, { unit: '<x>', status: '' }] });
  assert.match(html, /<caption class="sw-visually-hidden">Camiones<\/caption>/);
  assert.match(html, /<th scope="col">Unidad<\/th>/);
  assert.match(html, /<td>C-01<\/td>/);
  assert.match(html, /<td>&lt;x&gt;<\/td>/, 'texto escapado');
  assert.match(html, /sw-badge--en-ruta/, 'columnas html conservan el HTML ya generado por componentes');
  assert.match(dataTable({ caption: 'Vacía', columns: [{ key: 'a', label: 'A' }], rows: [], emptyText: 'No hay datos todavía' }), /No hay datos todavía/);
}

// Esqueleto de carga: oculto para lectores de pantalla pero anuncia que carga.
assert.match(skeleton({ lines: 3 }), /aria-busy="true"/);
assert.equal((skeleton({ lines: 3 }).match(/sw-skeleton__line/g) || []).length, 3);

// CSS: solo tokens (nada de colores sueltos) y objetivos táctiles de 48 px en la vista del chofer (CA-082-2).
{
  const components = readFileSync('frontend/styles/components.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(components, /#[0-9a-fA-F]{3,8}\b/, 'components.css no debe llevar colores fijos: usar tokens');
  assert.match(components, /:focus-visible/, 'foco visible para teclado');
  const tokens = parseTokens(readFileSync('frontend/styles/tokens.css', 'utf8')).base;
  const touch = parseFloat(tokens['touch-target']);
  assert.ok(touch >= 48, `--touch-target debe ser >= 48px (es ${tokens['touch-target']})`);
  for (const selector of ['.sw-driver .sw-btn', '.mobile button']) {
    const rule = components.split('}').find((chunk) => chunk.split('{')[0].split(',').map((s) => s.trim()).includes(selector));
    assert.ok(rule, `falta una regla para ${selector}`);
    assert.match(rule, /min-height:\s*var\(--touch-target\)/, `${selector} debe fijar min-height con el objetivo táctil`);
  }
  assert.match(components, /\.sw-visually-hidden/);
}

console.log('components ok');
