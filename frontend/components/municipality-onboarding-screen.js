// SW-120: "Nuevo ayuntamiento" en Master Admin. Solo pinta el modelo que recibe.
import { escapeHtml as e } from './button.js';

export function renderNewMunicipality({ open = false, busy = false, error = '', created = null, values = {} } = {}) {
  if (created) {
    return `<section class="onboard-card" aria-labelledby="onboardDoneTitle"><h4 id="onboardDoneTitle">Ayuntamiento creado: ${e(created.name)}</h4>
<p>Prueba de ${e(created.trucks)} camiones${created.validUntil ? ` hasta el ${e(created.validUntil)}` : ''}. Entrégale estos datos al administrador; la contraseña <b>solo se muestra ahora</b>.</p>
<dl class="onboard-creds"><dt>Correo</dt><dd>${e(created.email)}</dd><dt>Contraseña temporal</dt><dd><code data-onboard-password>${e(created.temporaryPassword)}</code></dd></dl>
<div class="controls"><button type="button" class="btn-primary" data-onboard-copy>Copiar mensaje para el administrador</button><button type="button" class="btn-secondary" data-onboard-done>Listo, ya la guardé</button></div>
<p class="profile-msg" role="status" data-onboard-copy-status></p></section>`;
  }
  if (!open) return '<div class="controls"><button type="button" class="btn-primary" data-onboard-open>Nuevo ayuntamiento</button></div>';
  return `<form class="onboard-card" data-onboard-form novalidate aria-labelledby="onboardTitle"><h4 id="onboardTitle">Nuevo ayuntamiento</h4>
<label>Nombre del ayuntamiento<input type="text" name="name" value="${e(values.name ?? '')}" maxlength="120" autocomplete="off" required></label>
<label>Correo del administrador<input type="email" name="email" value="${e(values.email ?? '')}" maxlength="120" autocomplete="off" required></label>
<label>Camiones de la prueba<input type="number" name="trucks" value="${e(values.trucks ?? 5)}" min="1" max="50" inputmode="numeric"></label>
<p class="demo">Se crea el ayuntamiento, la cuenta del administrador con una contraseña temporal y una prueba gratis de 60 días sin cobro.</p>
${error ? `<p class="profile-msg profile-msg--bad" role="alert" data-onboard-error>${e(error)}</p>` : ''}
<div class="controls"><button type="submit" class="btn-primary" data-onboard-create${busy ? ' disabled' : ''}>${busy ? 'Creando…' : 'Crear ayuntamiento'}</button><button type="button" class="btn-secondary" data-onboard-cancel${busy ? ' disabled' : ''}>Cancelar</button></div></form>`;
}
