// SW-114: combustible en galones americanos; gasto estimado solo por rendimiento de cada camión.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LITERS_PER_GALLON, litersToGallons, gallonsToLiters, kmPerLiterToKmPerGallon, kmPerGallonToKmPerLiter, pricePerLiterToPerGallon, pricePerGallonToPerLiter } from '../shared/fuel-units.js';
import { parseFuelGallons } from '../shared/fuel-entry.js';

assert.equal(LITERS_PER_GALLON, 3.785411784);
assert.equal(Math.round(litersToGallons(3.785411784) * 1e6) / 1e6, 1);
assert.equal(Math.round(gallonsToLiters(10) * 100) / 100, 37.85);
assert.equal(Math.round(kmPerLiterToKmPerGallon(2.2) * 10) / 10, 8.3);
assert.equal(kmPerGallonToKmPerLiter(8), 2.1134);
assert.equal(Math.round(pricePerLiterToPerGallon(76)), 288);
assert.equal(pricePerGallonToPerLiter(288), 76.0816);
assert.equal(litersToGallons(null), null);

// El conductor anota galones; se guarda en litros.
assert.deepEqual(parseFuelGallons(''), { ok: true, gallons: null, liters: null });
assert.deepEqual(parseFuelGallons('5,5'), { ok: true, gallons: 5.5, liters: 20.82 });
for (const bad of ['abc', '0', '-2', '131']) assert.equal(parseFuelGallons(bad).ok, false, bad);
assert.match(parseFuelGallons('abc').message, /galones/);

// Pantallas: sin litros a la vista en los textos del conductor y de flota.
const src = readFileSync('frontend/app.js', 'utf8');
assert.ok(!src.includes('Litros de combustible cargados'));
assert.match(src, /Rendimiento de referencia \(km\/galón\)/);
assert.match(src, /Precio combustible \(RD\$\/galón\)/);
console.log('sw114-galones ok');
