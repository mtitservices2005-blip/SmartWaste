// SW-119: reduce el logo elegido a PNG de máximo 320 px antes de guardarlo. Las piezas del navegador llegan por parámetro
// para poder probarlo sin DOM.
import { fitLogoSize, LOGO_MAX_SIDE, LOGO_MAX_BYTES } from './municipality-profile.js';

export async function resizeLogoFile(file, { readAsDataUrl, loadImage, makeCanvas } = {}) {
  if (!file || !/^image\/(png|jpeg)$/.test(file.type ?? '')) return { ok: false, message: 'Usa una imagen PNG o JPG.' };
  let src; let img;
  try { src = await readAsDataUrl(file); img = await loadImage(src); } catch { return { ok: false, message: 'No se pudo leer la imagen. Prueba con otra.' }; }
  const size = fitLogoSize(img.width, img.height, LOGO_MAX_SIDE);
  if (!size) return { ok: false, message: 'No se pudo leer la imagen. Prueba con otra.' };
  const canvas = makeCanvas(size.width, size.height);
  canvas.getContext('2d').drawImage(img, 0, 0, size.width, size.height);
  const logo = canvas.toDataURL('image/png');
  if (logo.length > LOGO_MAX_BYTES) return { ok: false, message: 'El logo sigue siendo muy pesado. Usa una imagen más simple.' };
  return { ok: true, logo, width: size.width, height: size.height, kb: Math.max(1, Math.round((logo.length * 0.75) / 1024)) };
}

// Piezas reales del navegador.
export const browserLogoDeps = {
  readAsDataUrl: (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); }),
  loadImage: (src) => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; }),
  makeCanvas: (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
};
