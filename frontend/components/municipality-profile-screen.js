// SW-119: formulario "Datos del ayuntamiento" (Configuración). Recibe un modelo ya armado; solo pinta.
import { escapeHtml as e } from './button.js';

export function renderProfileForm({ draft, status = '', logoNote = '', error = '', maxSigners = 3 } = {}) {
  const d = draft ?? { officialName: '', logo: '', address: '', phone: '', email: '', signers: [] };
  const signers = d.signers.map((s, i) => `<div class="profile-signer"><label>Nombre<input type="text" data-profile-signer-name="${i}" value="${e(s.name)}" maxlength="80" autocomplete="off"></label><label>Cargo<input type="text" data-profile-signer-role="${i}" value="${e(s.role)}" maxlength="60" autocomplete="off"></label><button type="button" class="btn-secondary" data-profile-del-signer="${i}" aria-label="Quitar firmante ${i + 1}">Quitar</button></div>`).join('') || '<p class="demo">Sin firmantes: los reportes dejan líneas de firma vacías.</p>';
  return `<div class="profile-form">
<label>Nombre oficial<input type="text" data-profile-field="officialName" value="${e(d.officialName)}" maxlength="120" autocomplete="off"></label>
<div class="profile-logo"><div class="profile-logo__prev" aria-live="polite">${d.logo ? `<img alt="Logo del ayuntamiento" src="${e(d.logo)}">` : 'Sin logo'}</div>
<div><label>Logo o escudo (PNG o JPG)<input type="file" data-profile-logo-file accept="image/png,image/jpeg"></label>${d.logo ? '<button type="button" class="btn-secondary" data-profile-logo-clear>Quitar logo</button>' : ''}${logoNote ? `<p class="demo" data-profile-logo-note>${e(logoNote)}</p>` : ''}</div></div>
<label>Dirección<input type="text" data-profile-field="address" value="${e(d.address)}" maxlength="160" autocomplete="off"></label>
<div class="profile-row"><label>Teléfono<input type="tel" data-profile-field="phone" value="${e(d.phone)}" maxlength="30" autocomplete="off"></label><label>Correo<input type="email" data-profile-field="email" value="${e(d.email)}" maxlength="120" autocomplete="off"></label></div>
<h4>Firmantes de los reportes</h4>${signers}
<div class="controls"><button type="button" class="btn-secondary" data-profile-add-signer${d.signers.length >= maxSigners ? ' disabled' : ''}>Agregar firmante</button><button type="button" class="btn-primary" data-profile-save>Guardar datos</button></div>
${error ? `<p class="profile-msg profile-msg--bad" role="alert" data-profile-error>${e(error)}</p>` : ''}${status ? `<p class="profile-msg" role="status" data-profile-status>${e(status)}</p>` : ''}
</div>`;
}
