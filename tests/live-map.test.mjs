import assert from 'node:assert/strict';
import { renderLiveHeader, renderLiveVehicleList, renderLiveEmpty, renderLiveError, renderLiveNoMunicipality } from '../frontend/components/live-map.js';

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
console.log('live-map ok');
