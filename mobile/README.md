# SmartWaste Conductor para Android

Base Android de Capacitor 7 que empaqueta la vista web existente. Esta tarea no cambia la lógica de roles ni incorpora todavía GPS en segundo plano.

## Requisitos

- Node.js 20 o posterior.
- Para compilar el APK localmente: JDK y Android SDK compatibles con el proyecto generado.

## Uso

Desde `mobile/`:

```powershell
npm ci
npm run sync:android
npm run build:android
```

El APK de depuración queda en `android/app/build/outputs/apk/debug/app-debug.apk`.

`build:web` copia en cada ejecución `../frontend/` y `../shared/` a `www/`; no modifica las fuentes. Sin variables de entorno, conserva el modo demo actual. Para apuntar una compilación a Supabase, define `SUPABASE_URL` y `SUPABASE_ANON_KEY` juntas antes de sincronizar. También admite `SUPABASE_MUNICIPALITY_ID` y `SUPABASE_HIDE_DEMO=true`. Ningún valor se guarda en el repositorio.
