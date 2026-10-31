// SW-085: las cuatro pantallas de la app del conductor (Hoy, En ruta, Terminar ruta, Acceso).
// HTML puro: todo texto pasa por escapeHtml; un dato que falta se muestra "—" o con un mensaje claro.
// Las acciones son data-attributes que frontend/driver-app.js delega; no hay lógica de red aquí.
import { escapeHtml as e } from './button.js';

const G_LOGO = '<span class="sw-driver__glogo" aria-hidden="true">G</span>';

function routeCard(r) {
  const meta = [`${Number(r.stopsCount) || 0} paradas`, r.distanceText || '—'];
  if (r.slot === 'siguiente' && Number(r.estimatedMinutes) > 0) meta.push(`tiempo estimado ${Math.round(Number(r.estimatedMinutes))} min`);
  const time = r.startLabel ? `<span class="sw-driver__time">${e(r.startLabel)}</span>` : '';
  let action = '';
  if (r.slot === 'siguiente') action = `<button type="button" class="sw-driver__cta" data-driver-start-route="${e(r.id)}">Iniciar ruta</button>`;
  else if (r.slot === 'en-curso') action = `<button type="button" class="sw-driver__cta" data-driver-open-run="${e(r.id)}">Continuar ruta</button>`;
  else if (r.slot === 'completada') action = '<p class="sw-driver__note"><span class="sw-driver__badge">Completada</span></p>';
  else if (r.startLabel) action = `<p class="sw-driver__note">Disponible a las ${e(r.startLabel)}</p>`;
  const cls = `sw-driver__route${r.slot === 'siguiente' || r.slot === 'en-curso' ? ' sw-driver__route--next' : ''}`;
  return `<li class="${cls}"><div class="sw-driver__route-top"><h3>${e(r.routeName)}</h3>${time}</div><p class="sw-driver__meta">${meta.map(e).join(' · ')}</p>${action}</li>`;
}

export function renderDriverToday({ name = '', dateText = '', unit = null, gpsActive = false, routes = [] } = {}) {
  const list = routes.length
    ? `<ul class="sw-driver__routes">${routes.map(routeCard).join('')}</ul>`
    : '<div class="sw-driver__empty"><p><strong>No tienes rutas asignadas para hoy.</strong></p><p>Cuando la central te asigne una, aparecerá aquí.</p></div>';
  return `<section class="sw-driver sw-driver--today" aria-label="Rutas de hoy">
    <header class="sw-driver__head"><div><p class="sw-driver__date">${e(dateText)} · Camión ${e(unit ?? '—')}</p><h1>Hola, ${e(name)}</h1></div><span class="sw-driver__chip${gpsActive ? ' sw-driver__chip--on' : ''}" role="status">${gpsActive ? 'GPS activo' : 'GPS inactivo'}</span></header>
    <h2 class="sw-driver__label">Rutas de hoy · ${routes.length}</h2>
    ${list}
    <p class="sw-driver__foot">Al iniciar, tu ubicación se comparte con la central en tiempo real.</p>
    <button type="button" class="sw-driver__link sw-driver__link--center" data-driver-logout>Cerrar sesión</button>
  </section>`;
}

export function renderDriverRun({ unit = null, connected = false, routeName = '', progressText = '—', nextStopLabel = null, nextStopDistance = '—', timeText = '—', distanceText = '—', pendingText = '—' } = {}) {
  const stat = (label, value, field) => `<div class="sw-driver__stat"><span>${e(label)}</span><strong data-driver-field="${field}">${e(value)}</strong></div>`;
  return `<section class="sw-driver sw-driver--run" aria-label="Ruta en curso">
    <div id="driverRunMap" class="sw-driver__map" role="application" aria-label="Mapa de la ruta en curso"></div>
    <div class="sw-driver__map-top"><span class="sw-driver__chip">Camión ${e(unit ?? '—')}</span><span data-driver-field="connected" class="sw-driver__chip${connected ? ' sw-driver__chip--on' : ' sw-driver__chip--off'}" role="status">${connected ? 'Conectado' : 'Sin conexión'}</span></div>
    <button type="button" class="sw-driver__recenter" data-driver-recenter hidden aria-label="Centrar el mapa en mi posición">Centrar en mí</button>
    <div class="sw-driver__sheet">
      <div class="sw-driver__grab" aria-hidden="true"></div>
      <div class="sw-driver__sheet-top"><h2>${e(routeName)}</h2><span data-driver-field="progress">${e(progressText)}</span></div>
      <div class="sw-driver__next"><div><span>Siguiente parada</span><strong data-driver-field="next-label">${e(nextStopLabel ?? 'Sin paradas pendientes')}</strong></div><span class="sw-driver__dist" data-driver-field="next-distance">${e(nextStopDistance)}</span></div>
      <div class="sw-driver__stats">${stat('Tiempo', timeText, 'time')}${stat('Distancia', distanceText, 'distance')}${stat('Pendientes', pendingText, 'pending')}</div>
      <button type="button" class="sw-driver__cta sw-driver__cta--danger" data-driver-finish-open>Terminar ruta</button>
    </div>
  </section>`;
}

export function renderDriverFinish({ routeName = '', timeText = '—', distanceText = '—', stopsText = '—', errorMessage = '', fuelValue = '' } = {}) {
  const stat = (label, value) => `<div class="sw-driver__stat"><span>${e(label)}</span><strong>${e(value)}</strong></div>`;
  const err = errorMessage ? `<p class="sw-driver__error" role="alert">${e(errorMessage)}</p>` : '<p class="sw-driver__error" role="alert"></p>';
  return `<section class="sw-driver sw-driver--finish" aria-label="Terminar ruta">
    <div class="sw-driver__sheet sw-driver__sheet--full">
      <div class="sw-driver__grab" aria-hidden="true"></div>
      <h2>Terminar ${e(routeName)}</h2>
      <p class="sw-driver__sub">Revisa el resumen y anota el combustible.</p>
      <div class="sw-driver__stats">${stat('Tiempo', timeText)}${stat('Distancia', distanceText)}${stat('Paradas', stopsText)}</div>
      <label class="sw-driver__field-label" for="driverFuelLiters">Combustible usado (litros)</label>
      <input class="sw-driver__input" id="driverFuelLiters" name="fuelLiters" type="text" inputmode="decimal" autocomplete="off" placeholder="Ejemplo: 18,5" value="${e(fuelValue)}">
      ${err}
      <button type="button" class="sw-driver__cta" data-driver-finish-save>Guardar y terminar</button>
      <button type="button" class="sw-driver__cta sw-driver__cta--ghost" data-driver-finish-back>Volver a la ruta</button>
    </div>
  </section>`;
}

export function renderDriverAccess({ errorMessage = '' } = {}) {
  const err = errorMessage ? `<p class="sw-driver__error" role="alert">${e(errorMessage)}</p>` : '<p class="sw-driver__error" role="alert"></p>';
  return `<section class="sw-driver sw-driver--access" aria-label="Acceso del conductor">
    <div class="sw-driver__brand"><span class="sw-driver__logo" aria-hidden="true">SW</span><span>SmartWaste</span></div>
    <h1>Hola, conductor</h1>
    <p class="sw-driver__sub">Entra para ver tus rutas de hoy.</p>
    <button type="button" class="sw-driver__google" data-driver-google>${G_LOGO}<span>Continuar con Google</span></button>
    <p class="sw-driver__or"><span>o con tu correo</span></p>
    <form id="driverLoginForm" class="sw-driver__form" novalidate>
      <label class="sw-driver__field-label" for="driverEmail">Correo</label>
      <input class="sw-driver__input" id="driverEmail" name="email" type="email" autocomplete="username" placeholder="nombre@ejemplo.do" required>
      <label class="sw-driver__field-label" for="driverPassword">Contraseña</label>
      <input class="sw-driver__input" id="driverPassword" name="password" type="password" autocomplete="current-password" required>
      <button type="button" class="sw-driver__link" data-driver-forgot>¿Olvidaste tu contraseña?</button>
      ${err}
      <button type="submit" class="sw-driver__cta">Entrar</button>
    </form>
    <p class="sw-driver__foot">¿No tienes acceso? Pídele a la central que registre tu correo.</p>
  </section>`;
}

export function renderDriverLoadError({ message = '' } = {}) {
  return `<section class="sw-driver sw-driver--error" aria-label="No se pudieron cargar tus rutas">
    <div class="sw-driver__empty"><p><strong>No se pudieron cargar tus rutas.</strong></p><p>${e(message)}</p></div>
    <button type="button" class="sw-driver__cta" data-driver-retry>Reintentar</button>
    <button type="button" class="sw-driver__link sw-driver__link--center" data-driver-logout>Cerrar sesión</button>
  </section>`;
}

// SW-107: divulgación destacada que Google Play exige antes de pedir la ubicación en segundo plano.
export function renderDriverDisclosure({ notificationText = 'SmartWaste está registrando tu recorrido', privacyUrl = '' } = {}) {
  const policy = privacyUrl
    ? `<a class="sw-driver__link" href="${e(privacyUrl)}" target="_blank" rel="noopener">Política de privacidad</a>`
    : 'Política de privacidad (disponible en la ficha de la app en Google Play)';
  return `<section class="sw-driver sw-driver--disclosure" aria-labelledby="driverDisclosureTitle">
    <h1 id="driverDisclosureTitle">Ubicación en segundo plano</h1>
    <p>SmartWaste Conductor recoge la <strong>ubicación precisa de tu teléfono</strong> para mostrarle a tu ayuntamiento dónde va el camión, medir los kilómetros y verificar el avance de la ruta.</p>
    <p>Sigue funcionando en <strong>segundo plano</strong>, también con la pantalla apagada o con la app cerrada, pero <strong>solo durante una ruta que tú inicies</strong>. Mientras tanto verás la notificación "${e(notificationText)}". Al terminar la ruta, se detiene.</p>
    <p>El público ve el camión en el mapa, nunca tu nombre. Puedes retirar el permiso cuando quieras desde los ajustes de Android, pero sin él no podemos registrar tu recorrido.</p>
    <p class="sw-driver__fine">${policy}.</p>
    <button type="button" class="sw-driver__cta" data-driver-disclosure-accept>Entiendo y continuar</button>
    <button type="button" class="sw-driver__cta sw-driver__cta--ghost" data-driver-disclosure-decline>Ahora no</button>
  </section>`;
}
