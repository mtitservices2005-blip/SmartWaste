// SW-088: pantalla de acceso web del personal (diseño Mando): mapa con lema a la izquierda y formulario a la
// derecha. HTML puro; todo texto dinámico pasa por escapeHtml. No hay registro: las cuentas las crea el administrador.
import { escapeHtml as e } from './button.js';

const G_LOGO = '<span class="sw-login__glogo" aria-hidden="true">G</span>';

const MAP = `<svg class="sw-login__svg" viewBox="0 0 640 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
  <g class="sw-login__streets"><path d="M-20 130 L300 118 L700 98"/><path d="M-20 590 L330 560 L700 540"/><path d="M60 -20 L110 720"/><path d="M360 -20 L400 720"/><path d="M590 -20 L620 720"/></g>
  <polyline class="sw-login__route sw-login__route--b" points="120,120 135,255 210,355"/>
  <polyline class="sw-login__route" points="30,590 100,520 165,430 300,390 430,345 530,320"/>
  <polyline class="sw-login__route sw-login__route--dash" points="530,320 640,300"/>
  <circle class="sw-login__truck" cx="320" cy="348" r="8"/><text class="sw-login__tag" x="338" y="352">C-02</text>
  <circle class="sw-login__truck" cx="634" cy="326" r="8"/>
</svg>`;

export function renderStaffLogin({ demo = false, googleEnabled = false, errorMessage = '' } = {}) {
  const sub = demo ? 'Gestión de residuos para Laguna Salada. Datos de ejemplo.' : 'Gestión de residuos para Laguna Salada.';
  const google = googleEnabled
    ? `<button type="button" class="sw-login__google" data-staff-google>${G_LOGO}<span>Continuar con Google</span></button><p class="sw-login__or"><span>o con tu correo</span></p>`
    : '';
  const note = googleEnabled ? '<p class="sw-login__note">Con Google no guardamos tu contraseña. Solo recibimos tu nombre y tu correo.</p>' : '';
  return `<section class="sw-login" aria-label="Acceso a SmartWaste">
    <div class="sw-login__side">${MAP}
      <div class="sw-login__brand"><span class="sw-login__logo" aria-hidden="true">SW</span><span>SmartWaste</span></div>
      <div class="sw-login__tagline"><p>Cada camión, cada ruta, en un solo mapa.</p><small>${e(sub)}</small></div>
    </div>
    <div class="sw-login__panel">
      <div class="sw-login__card">
        <div class="sw-login__brand sw-login__brand--mobile"><span class="sw-login__logo" aria-hidden="true">SW</span><span>SmartWaste</span></div>
        ${demo ? '<p class="demo sw-login__demo">Datos demo · no producción</p>' : ''}
        <h1>Bienvenido de nuevo</h1>
        <p class="sw-login__sub">Entra para ver tus rutas y camiones.</p>
        ${google}
        <form id="authForm" class="sw-login__form" novalidate>
          <label for="authEmail">Correo</label>
          <input id="authEmail" name="email" type="email" autocomplete="username" placeholder="nombre@ejemplo.do" required>
          <label for="authPassword">Contraseña</label>
          <input id="authPassword" name="password" type="password" autocomplete="current-password" placeholder="Mínimo 8 caracteres" required>
          <button type="button" class="sw-login__link" data-staff-forgot>¿Olvidaste tu contraseña?</button>
          <p id="authError" class="sw-login__error" role="alert">${e(errorMessage)}</p>
          <button type="submit" class="sw-login__cta">Entrar</button>
        </form>
        ${note}
        <p class="sw-login__foot">¿No tienes acceso? Pídele a tu administrador que te cree la cuenta.</p>
        <p class="sw-login__foot"><a href="#ciudadania" id="skipToPublic">Portal ciudadano</a></p>
      </div>
    </div>
  </section>`;
}
