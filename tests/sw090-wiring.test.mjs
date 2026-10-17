// SW-090: app.js conecta Métricas y la edición de rendimiento del camión; el estilo está enlazado.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const app = readFileSync(new URL('../frontend/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
assert.match(html, /styles\/metrics\.css/);
for (const needle of ['renderMetricsPage', 'buildMetricsView', 'realAdapter.listFuelLogs()', 'realAdapter.markRouteRunTest(', 'realAdapter.listRunTrack(', 'updateVehicleFromForm', "fleetAction === 'update-vehicle'", 'fuel_efficiency_km_per_l', 'handleMetricsClick(event)', "estadisticas: 'Métricas'"]) {
  assert.ok(app.includes(needle), `app.js debe contener ${needle}`);
}
assert.ok(!app.includes('service_role'));
console.log('sw090-wiring: ok');
