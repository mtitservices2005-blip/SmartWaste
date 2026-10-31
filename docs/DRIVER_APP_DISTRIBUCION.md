# Distribución directa de SmartWaste Conductor (fuera de Google Play) — SW-108

Mientras la app no esté en Play Store, el APK firmado se publica en el propio sitio de SmartWaste (Vercel) y los
choferes lo descargan en `https://<tu-sitio>/descargar`. La app avisa cuando hay una versión más nueva.

## Una sola vez
1. En GitHub: Settings → Secrets and variables → Actions → **Variables** → crear `SMARTWASTE_UPDATE_BASE_URL` con la URL
   pública del sitio, sin barra final (ejemplo `https://tu-sitio.vercel.app`). Es una variable, no un secreto.
   Sin ella, el APK compila igual pero **no avisa** de actualizaciones.
2. Guardar el keystore en dos sitios seguros: las actualizaciones solo se instalan encima si usan la misma firma.

## Publicar una versión
1. Ejecutar el workflow **Android release APK (signed)** en `main` (el `version_code` queda ascendente por fecha).
2. Descargar el artefacto, descomprimirlo y quedarse con `SmartWaste-Driver-release.apk` (no el `.aab`).
3. Desde la raíz del repo, en una rama nueva:
   `node scripts/publish-apk.mjs --apk <ruta>\SmartWaste-Driver-release.apk --version-name 1.0.1 --version-code <el del workflow> --notes "Qué cambió"`
4. Commit de `downloads/`, PR y merge. Vercel despliega solo; `/descargar` muestra la versión nueva.
5. Los teléfonos con una versión anterior verán "Hay una versión nueva" al abrir la app (y cada 6 horas), solo en Hoy y nunca con una ruta en curso.

## Reglas
- `--version-code` debe ser **mayor** que el del APK instalado; si no, Android rechaza la actualización y la app no avisa.
- Solo se publica el `.apk`. El `.aab` es para Play Store.
- Cada versión agrega el tamaño del APK al historial de git. Si crece demasiado, mover `downloads/` a un almacenamiento externo
  (la app solo necesita que `version.json` sea público y tenga CORS abierto).
- La app solo consulta el manifiesto por https y solo abre APK servidos por https.
