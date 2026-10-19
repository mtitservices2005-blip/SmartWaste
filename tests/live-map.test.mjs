import assert from 'node:assert/strict';
import { renderLiveHeader, renderLiveVehicleList, renderLiveEmpty, renderLiveError, renderLiveNoMunicipality, renderLiveIconPicker, renderLiveMarker, LIVE_ICONS } from '../frontend/components/live-map.js';

const v = (o = {}) => ({ code: 'C-01', routeName: 'Ruta Norte', status: 'en_ruta', statusText: 'En ruta', ...o });

assert.match(renderLiveEmpty(), /Hoy aún no hay camiones en ruta/);
assert.match(renderLiveError({ hasData: true }), /No pudimos actualizar\. Reintentando…/);
assert.match(renderLiveError({ hasData: false }), /No pudimos actualizar\. Reintentando…/);
assert.match(renderLiveNoMunicipality(), /municipio/i);
assert.match(renderLiveHeader({ municipalityName: 'Laguna Salada', updatedAgoText: 'hace 5 s' }), /Laguna Salada[\s\S]*hace 5 s/);

const list = renderLiveVehicleList({ vehicles: [v(), v({ code: 'C-02', status: 'sin_senal', statusText: 'Sin señal' })], selectedCode: 'C-01' });
assert.match(list, /data-live-vehicle="C-01"/);
assert.match(list, /data-live-vehicle="C-02"/);
assert.match(list, /Ruta Norte/);
assert.match(list, /aria-current="true"/);
assert.equal((list.match(/aria-current="true"/g) || []).length, 1);
assert.equal((list.match(/is-stale/g) || []).length, 1);

const evil = renderLiveVehicleList({ vehicles: [v({ routeName: '<img src=x onerror=1>&' })], selectedCode: null });
assert.ok(evil.includes('&lt;img src=x onerror=1&gt;&amp;'));
assert.ok(!evil.includes('<img'));

for (const html of [list, renderLiveEmpty(), renderLiveHeader({ municipalityName: 'X', updatedAgoText: 'y' })]) {
  assert.ok(!/plate|battery|driver/i.test(html));
}
assert.deepEqual(LIVE_ICONS.map((i) => i.id), ['punto', 'compactador', 'volquete', 'camioneta']);
const picker = renderLiveIconPicker({ selected: 'volquete' });
for (const i of LIVE_ICONS) assert.match(picker, new RegExp(`data-live-icon="${i.id}"`));
assert.match(picker, /data-live-icon="volquete"[^>]*aria-pressed="true"/);
assert.ok(!/<span/.test(picker), 'el selector no lleva texto visible');
assert.match(picker, /aria-label="Volquete"/);
assert.equal((picker.match(/aria-pressed="true"/g) || []).length, 1);
assert.match(renderLiveIconPicker({ selected: 'xx' }), /data-live-icon="compactador"[^>]*aria-pressed="true"/);
assert.match(renderLiveMarker({ icon: 'camioneta', status: 'detenido' }), /live-marker--detenido[\s\S]*<svg/);
console.log('live-map ok');
