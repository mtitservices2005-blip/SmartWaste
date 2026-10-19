// SW-103: .sw-citizen { display:flex } (live.css, cargado al final) pisaba .hidden { display:none } de styles.css
// y la sección Ciudadanía (calendario + Consulta de recogida) se veía en todas las pantallas.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync('frontend/styles/live.css', 'utf8').replace(/\r\n/g, '\n');
assert.match(css, /\.sw-citizen\.hidden\s*\{\s*display:\s*none;?\s*\}/, '.sw-citizen.hidden debe seguir oculta');
assert.match(css, /\.sw-citizen__live\[hidden\][^{]*\{\s*display:\s*none/, '[hidden] respetado en el contenedor en vivo');
assert.match(css, /#liveCalendarWrap\[hidden\][^{]*\{\s*display:\s*none/, 'calendario con [hidden] respetado');

// Regla general: toda clase de sección con display propio en live.css debe tener su variante .hidden.
const app = readFileSync('frontend/app.js', 'utf8');
assert.match(app, /<section id="ciudadania" class="section card sw-citizen/, 'ciudadania usa sw-citizen');
console.log('sw103-citizen-hidden OK');
