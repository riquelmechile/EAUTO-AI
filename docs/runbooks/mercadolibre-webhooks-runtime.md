# MercadoLibre Chile — webhooks y runtime 24/7

## Propósito

Recibir señales de MercadoLibre Chile durante las 24 horas, persistirlas antes de responder y actualizar los read models de Plasticov y Maustian sin ejecutar mutaciones ni despertar un LLM.

## Flujo verificable

1. MercadoLibre envía una notificación a `POST /v1/webhooks/mercadolibre`.
2. El API valida forma, tamaño, `application_id`, seller y topic.
3. Solo se guardan metadatos operativos compactos; no se persiste el body remoto completo.
4. Una idempotency key SHA-256 impide insertar dos veces el mismo delivery.
5. El API responde `200` sin consultar APIs remotas ni invocar agentes.
6. El worker reclama señales mediante lease durable y `FOR UPDATE SKIP LOCKED`.
7. Las señales del mismo account y familia dentro del batch se agrupan.
8. Se ejecuta una sola sincronización read-only:
   - `items`: catálogo y publicaciones;
   - `questions` y `claims`: atención;
   - `orders_v2`, `shipments` y `payments`: órdenes y reputación.
9. El evento queda `processed`; un error aplica backoff y termina en `dead` al superar el máximo.

## Configuración

- `MELI_WEBHOOK_ENABLED=true`
- `MELI_APPLICATION_ID=<application id real>`
- `MELI_WEBHOOK_TOKEN=<token aleatorio de al menos 32 caracteres>`
- `MELI_NOTIFICATION_WORKER_ID`
- `MELI_NOTIFICATION_POLL_INTERVAL_MS`
- `MELI_NOTIFICATION_BATCH_SIZE`
- `MELI_NOTIFICATION_LEASE_MS`
- `MELI_NOTIFICATION_MAX_ATTEMPTS`
- `MELI_NOTIFICATION_BASE_RETRY_MS`
- `MELI_NOTIFICATION_MAX_RETRY_MS`

Configure en MercadoLibre la URL `https://<API_DOMAIN>/v1/webhooks/mercadolibre?token=<MELI_WEBHOOK_TOKEN>`.
El modo webhook exige MercadoLibre habilitado, application ID, token de URL y los seller IDs chilenos de ambas cuentas. Plasticov y Maustian se resuelven desde esos seller IDs; nunca desde un account ID enviado por el webhook.

## Seguridad

- El endpoint público nunca revela si un seller o application ID existe.
- No registra tokens, mensajes, direcciones, comprador ni payload completo.
- Topics no soportados reciben `200` y no se encolan.
- El webhook no realiza escrituras de negocio.
- La capa no depende de LLM, memoria semántica ni prompts.
- Los leases vencidos son recuperables por otro worker.
- El loop usa `await`; no existen ejecuciones superpuestas por `setInterval`.

## Operación y recuperación

- `pending`: listo para procesar.
- `processing`: reclamado con owner y vencimiento.
- `processed`: sincronización completada.
- `dead`: requiere revisión operacional.

Endpoints administrativos, protegidos por RBAC y account scope:

- `GET /v1/operations/mercadolibre-notifications/:accountId/stats`
- `GET /v1/operations/mercadolibre-notifications/:accountId/dead`
- `POST /v1/operations/mercadolibre-notifications/:accountId/dead/:id/requeue`

Corrija primero credenciales, límites o disponibilidad remota. Después reencole mediante el endpoint; no edite filas manualmente en producción.

## Staging

1. Configure una URL HTTPS de notificaciones en la aplicación MercadoLibre.
2. Envíe un delivery de prueba para Plasticov y confirme una sola fila aunque se repita.
3. Confirme que el worker actualiza únicamente Plasticov.
4. Repita con Maustian.
5. Simule dos topics comerciales en el mismo batch y confirme una sola sincronización.
6. Interrumpa el worker, espere el vencimiento del lease y confirme recuperación.
7. Fuerce fallos hasta `dead`, corrija la causa y reencole mediante API.
8. Confirme que no hubo llamadas LLM ni mutaciones en MercadoLibre.
