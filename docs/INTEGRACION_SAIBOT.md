# Integración Saibot ↔ SmartWaste: reportes de basura acumulada

Estado: SW-127 (entrada y bandeja) implementado. El aviso de cierre a Saibot (SW-128) y la asignación a camión con parada extra (SW-129) están pendientes.

## Cómo funciona
- Saibot envía cada reporte de basura acumulada a SmartWaste con una llamada segura. No hay conexión directa entre bases de datos.
- Cada ayuntamiento tiene su propia clave. La genera el administrador en Configuración → Integraciones y se muestra una sola vez; en la base solo se guarda su hash (SHA-256).
- El personal del ayuntamiento ve los reportes en Operaciones → Basura acumulada (lista, plano y detalle) y los marca como atendidos o "no procede" (con motivo).
- La integración es opcional por ayuntamiento. Si Saibot no tiene la integración activa, el reporte sigue su camino interno en Saibot.
- Solo se enrutan reportes nuevos después de activar la integración.

## Contrato 1: Saibot → SmartWaste (entrada)
`POST https://<proyecto>.supabase.co/functions/v1/saibot-ingest-report`

Encabezados: `Content-Type: application/json` y `X-SmartWaste-Key: swk_<64 hex>`.

```json
{
  "external_id": "SAIBOT-2026-000123",
  "reported_at": "2026-11-11T14:05:00-04:00",
  "description": "Basura acumulada frente a la escuela, hace tres días",
  "location": { "lat": 19.8742, "lng": -71.3511, "reference": "Calle Duarte esquina Sánchez" },
  "photos": ["https://.../foto1.jpg"]
}
```

Respuestas:
- `201 {"id", "status": "new"}`: reporte creado.
- `200 {"id", "status", "duplicate": true}`: ya existía ese `external_id`; no se duplica. Saibot puede reintentar sin riesgo.
- `400`: datos inválidos (el cuerpo dice qué campo). `401`: clave inválida o integración desactivada. `413`: cuerpo mayor a 20 000 caracteres. `429`: más de 60 reportes por minuto. Se reintenta pasado un minuto.

Reglas: `external_id` hasta 80 caracteres; `description` hasta 500; `location` es opcional, pero `lat` y `lng` van juntos (lat entre -90 y 90, lng entre -180 y 180); `reference` hasta 200; hasta 5 fotos con URL https; `reported_at` en ISO 8601 y no más de 24 h en el futuro. La clave identifica al ayuntamiento: Saibot no envía su id. No se envían datos personales del ciudadano.

## Contrato 2: SmartWaste → Saibot (cierre), pendiente en SW-128
SmartWaste llamará a la dirección que el ayuntamiento registre, con una firma HMAC-SHA256 sobre `<timestamp>.<cuerpo>` en `X-SmartWaste-Signature` y la marca de tiempo en `X-SmartWaste-Timestamp`. Evento `waste_report.closed` con `outcome` = `collected` o `not_applicable`. Saibot responde `2xx` si lo procesó (idempotente por `external_id` y `event`). Detalle en el documento del proyecto.

## Seguridad
- Clave por ayuntamiento, con hash; regenerarla invalida la anterior al instante; se puede desactivar.
- Las tablas `saibot_integrations` y `waste_reports` tienen RLS; los clientes no escriben directo. Los cambios pasan por funciones del servidor que validan permisos y estados.
- El texto que llega de Saibot se trata como no confiable y se escapa al mostrarlo; solo se aceptan fotos con URL https.
- La función de entrada se despliega sin verificación de JWT (`verify_jwt = false`) porque la autenticación es la clave.

## Despliegue
1. Aplicar la migración `202611110001_sw127_basura_saibot.sql`.
2. Desplegar la función `saibot-ingest-report` con `verify_jwt = false`.
3. En Configuración → Integraciones, el administrador genera la clave y la entrega al equipo de Saibot junto con la dirección de la función.
