// SW-084 (CA4, CA5, CA6): piezas del centro de control. HTML puro; el estado de cada camión siempre
// lleva icono + texto + color (insignia de SW-082) y los datos que faltan se muestran "—".
import assert from 'node:assert/strict';
import { mapTruckStatus, renderFleetList } from '../frontend/components/fleet-panel.js';
import { renderKpiBar, renderLiveChip } from '../frontend/components/kpi-bar.js';

// Estados del modelo de la plataforma → insignia (estado + etiqueta) y estado para los indicadores.
assert.deepEqual(mapTruckStatus('active'), { badge: 'en-ruta', label: 'En ruta', kpi: 'en_ruta' });
assert.deepEqual(mapTruckStatus('delayed'), { badge: 'en-ruta', label: 'Con retraso', kpi: 'en_ruta' });
assert.deepEqual(mapTruckStatus('stopped'), { badge: 'detenido', label: 'Detenido', kpi: 'detenido' });
assert.deepEqual(mapTruckStatus('completed'), { badge: 'disponible', label: 'Completada', kpi: 'disponible' });
assert.deepEqual(mapTruckStatus('offline'), { badge: 'sin-senal', label: 'Sin señal', kpi: 'sin_senal' });
assert.deepEqual(mapTruckStatus('maintenance'), { badge: 'fuera-servicio', label: 'En mantenimiento', kpi: 'fuera_servicio' });
assert.deepEqual(mapTruckStatus('raro'), { badge: 'fuera-servicio', label: 'Sin estado', kpi: 'fuera_servicio' }, 'un estado desconocido no rompe la lista');

const trucks = [
  { id: 'truck-01', unit: 'SW-LS-01', state: 'active', routeName: 'Ruta Centro', progress: 68, updatedAt: 'Hace 2 min' },
  { id: 'truck-05', unit: 'SW-LS-05 <b>', state: 'offline', routeName: null, progress: 0, updatedAt: 'Hace 41 min' }
];
const list = renderFleetList({ trucks, selectedId: 'truck-01' });
assert.match(list, /<aside|<section|<div class="sw-fleet__head"/);
assert.ok(list.includes('2 camiones'));
assert.match(list, /<button type="button" class="sw-truck[^"]*" data-truck="truck-01"/, 'cada fila es un botón con data-truck (app.js ya delega ese clic)');
assert.match(list, /data-truck="truck-01"[^>]*class="[^"]*selected|class="[^"]*selected[^"]*"[^>]*data-truck="truck-01"/, 'marca el camión elegido');
assert.ok(list.includes('sw-badge--en-ruta') && list.includes('sw-badge--sin-senal'), 'insignias con icono + texto');
assert.ok(list.includes('Ruta Centro') && list.includes('68%'));
assert.ok(list.includes('Sin ruta'), 'camión sin ruta lo dice');
assert.ok(!list.includes('<b>'), 'el texto se escapa');
assert.ok(list.includes('&lt;b&gt;'));
assert.ok(list.includes('sw-truck--alert'), 'sin señal se destaca como alerta');
assert.ok(renderFleetList({ trucks: [] }).includes('Todavía no hay camiones'), 'lista vacía explica qué pasa');

// Indicadores.
const kpis = { enRuta: 3, alerts: 1, coverage: '64%', distance: '41 km', fuel: '—', freshness: 'EN VIVO · 8 s' };
const bar = renderKpiBar(kpis);
assert.match(bar, /id="swKpis"/);
for (const label of ['En ruta', 'Cobertura hoy', 'Distancia de rutas', 'Combustible']) assert.ok(bar.includes(label), `falta ${label}`);
for (const value of ['>3<', '64%', '41 km', '—']) assert.ok(bar.includes(value), `falta ${value}`);
assert.ok(bar.includes('1 sin señal'), 'la alerta aparece junto a En ruta');
assert.ok(!renderKpiBar({ ...kpis, alerts: 0 }).includes('sin señal'));
assert.ok(renderKpiBar(kpis).includes('sin registros'), 'combustible ausente lo explica');

// Chip "en vivo": en demo nunca dice EN VIVO (regla permanente 7).
assert.match(renderLiveChip({ freshness: 'EN VIVO · 8 s', demo: false }), /role="status"[^>]*>EN VIVO · 8 s</);
assert.match(renderLiveChip({ freshness: 'SIN DATOS RECIENTES', demo: false }), /sw-chip--stale/);
const demoChip = renderLiveChip({ freshness: 'EN VIVO · 8 s', demo: true });
assert.ok(demoChip.includes('Datos demo · no producción') && !demoChip.includes('EN VIVO'));
console.log('mando-control ok');

// SW-084: el detalle del camión se coloca debajo de su fila y sobrevive al redibujado de la lista.
import { readFileSync } from 'node:fs';
const appSrc = readFileSync(new URL('../frontend/app.js', import.meta.url), 'utf8');
assert.match(appSrc, /function placeDetail\(\)/, 'existe placeDetail');
assert.match(appSrc, /panel\.appendChild\(detail\);\s*\n\s*list\.innerHTML/, 'el detalle sale de la lista antes de redibujarla');
assert.match(appSrc, /placeDetail\(\); \}/, 'openDetail coloca el detalle');
