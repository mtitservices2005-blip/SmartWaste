# Seguridad pre-lanzamiento — SW-072

> Plan de lanzamiento · Días 6-7. Ejecución local únicamente.
> Este documento **no** certifica producción: describe qué se escaneó, con qué comando y el
> resultado observado en la ronda local del 2026-10-03. El escaneo no sustituye la decisión de
> Miguel ni una revisión de seguridad en el entorno real.

## Alcance del escaneo

Objetivo: confirmar que no hay secretos de alta confianza (claves privadas, tokens de servicio,
credenciales de nube) filtrados en el repositorio ni en su historial, y que la `service_role` de
Supabase no llega al frontend.

Superficie cubierta:

1. **Worktree** — todos los archivos rastreados por Git (`git grep`), incluidos `frontend/`,
   `scripts/`, `supabase/` y `docs/`.
2. **Historial reciente y completo** — el contenido de los diffs de todos los commits alcanzables
   (`git log -p --all`), para detectar un secreto que se haya commiteado y luego borrado.
3. **Prueba anti `service-role`** — control separado sobre el frontend y el resultado del build
   (`frontend/` y `dist/`). Ver la sección "Prueba anti service-role" más abajo.

Queda **fuera de alcance** de esta ronda: entornos remotos (Supabase, Vercel), binarios no
rastreados, archivos ignorados por `.gitignore`, y el contenido servido por servicios externos.

## Comandos reproducibles

### 1. Intento con `gitleaks` (herramienta dedicada)

```sh
command -v gitleaks >/dev/null 2>&1 && gitleaks version || echo "gitleaks: command not found"
```

Resultado observado: `gitleaks: command not found` — la herramienta **no está instalada** en este
entorno, por lo que no se ejecutó `gitleaks detect`. No se instaló nada desde la red para esta
ronda. Si en el futuro se instala `gitleaks`, debe repetirse el escaneo con
`gitleaks detect --no-banner` (worktree) y `gitleaks detect --log-opts="--all"` (historial) y
anexar su salida aquí.

### 2. Fallback: patrones de alta confianza (sin herramienta dedicada)

Ante la ausencia de `gitleaks` se usó un conjunto acotado de patrones de alta confianza. El
comando **solo imprime un conteo**; nunca imprime los valores que coincidan.

```sh
PAT='-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|sb_secret_[A-Za-z0-9_-]{20,}|sbp_[0-9a-f]{40}'

# Worktree: cuenta de archivos rastreados con coincidencia (no imprime contenido ni nombres)
WT=$(git grep -lE -e "$PAT" -- . 2>/dev/null | wc -l | tr -d ' ')
echo "HIGH_CONFIDENCE_WORKTREE_MATCHES=$WT"

# Historial: cuenta de líneas de diff con coincidencia (no imprime contenido)
HIST=$(git log -p --all 2>/dev/null | grep -a -cE -e "$PAT")
echo "HIGH_CONFIDENCE_HISTORY_MATCHES=$HIST"
```

Categorías cubiertas por el patrón: claves privadas PEM, claves de acceso AWS, tokens de GitHub,
tokens de Slack, claves de API de Google y las formas de clave de servicio/secretas de Supabase.
Los patrones de alta confianza tienen **baja tasa de falsos positivos** pero **no** son un sustituto
de una herramienta completa: no detectan contraseñas en texto plano, tokens de forma desconocida ni
secretos fragmentados o codificados.

## Resultado exacto (ronda local del 2026-10-03)

```text
HIGH_CONFIDENCE_WORKTREE_MATCHES=0
HIGH_CONFIDENCE_HISTORY_MATCHES=0
SCAN_STATUS=NO_HIGH_CONFIDENCE_SECRET_DETECTED
```

- No se detectaron coincidencias de alta confianza ni en el worktree ni en el historial.
- **No se pega ningún candidato, coincidencia ni secreto** en este documento: el resultado se
  expresa únicamente como conteo. Si el conteo hubiera sido distinto de cero, este informe no
  habría incluido el valor — solo el número y la instrucción de la sección "Política ante un
  secreto real".

## Prueba anti `service-role` (control local)

La regla 8 de `CLAUDE.md` prohíbe exponer la `service_role` de Supabase al frontend o a
dispositivos físicos. El control previsto es una prueba en `tests/` que **falla** si aparece
`service_role` (o una clave con forma de JWT de servicio) en `frontend/` o en el resultado del
build (`dist/`), y que **pasa** con el código actual.

Estado: **PENDIENTE**. Esta prueba corresponde a la matriz de pruebas de SW-072 y **debe
ejecutarse en la matriz SW-072**; mientras no esté fusionada **no se afirma que exista ni que se
haya ejecutado**. Hasta entonces, el control anti `service-role` es la revisión manual de que la
`service_role` solo vive en el proceso local del operador (ver `docs/STAGING_RUNBOOK.md`) y nunca se
configura en Vercel ni llega al navegador.

## Política ante un secreto real

Si cualquier escaneo (presente o futuro) detecta un secreto real:

1. **Detener el pipeline de inmediato.** No continuar con build, deploy, commit, push ni PR de esa
   ronda.
2. **No copiar el secreto** a chat, PR, issues, logs, capturas, captions, tickets ni a este
   documento. Reportar únicamente la existencia, el archivo/ubicación aproximada y el tipo de
   secreto, **nunca su valor**.
3. **Notificar a Miguel** (Project Owner) **sin incluir el valor** del secreto, por el canal
   aprobado.
4. **No rotar, revocar ni alterar credenciales** sin la decisión explícita de Miguel. La rotación
   de claves queda fuera del alcance de SW-072 y no la ejecuta el pipeline.

## Límites de esta evidencia

- Escaneo **local**, con patrones acotados de alta confianza tras la ausencia de `gitleaks`.
- No cubre archivos ignorados, binarios no rastreados, entornos remotos ni el contenido servido en
  producción.
- No certifica el estado de Vercel ni de Supabase.
- La prueba automatizada anti `service-role` aún **no está fusionada** y queda **pendiente de
  ejecutarse en la matriz de CI de SW-072** antes de cualquier go/no-go.
