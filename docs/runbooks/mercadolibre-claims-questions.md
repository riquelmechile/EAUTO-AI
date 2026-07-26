# MercadoLibre Chile — reclamos y preguntas read-only

## Alcance

Este slice extiende el read model de Plasticov y Maustian con las dos señales operativas más urgentes recomendadas por MSL:

- reclamos del seller como `respondent`;
- preguntas recibidas por el seller.

No descarga mensajes completos, adjuntos, texto de preguntas ni identidad de compradores. No responde preguntas, no interviene reclamos y no ejecuta mutaciones.

## Endpoints remotos

- Reclamos: `GET /post-purchase/v1/claims/search`
  - `players.user_id=<sellerId>`
  - `players.role=respondent`
  - paginación por `limit` y `offset`.
- Preguntas: `GET /questions/search`
  - `seller_id=<sellerId>`
  - `api_version=4`
  - orden descendente por fecha.

Todas las solicitudes usan `Authorization: Bearer` y el mismo ciclo seguro de refresh de la conexión MLC.

## Datos conservados

### Reclamos

- ID del reclamo y recurso.
- estado, tipo y etapa.
- reason ID opcional.
- indicador `fulfilled` opcional.
- fechas de creación y actualización.
- hash de la representación normalizada.

### Preguntas

- ID de pregunta y publicación.
- estado y fecha.
- indicadores de respuesta, retención y posible spam.
- hash de la representación normalizada.

No se persiste texto ni buyer ID.

## Flujo

1. Android o un worker solicita sincronización de atención para una cuenta.
2. El backend obtiene un access token válido mediante el lease de refresh existente.
3. Reclamos y preguntas se consultan en paralelo.
4. Cada payload se valida y normaliza.
5. Se agregan organización, cuenta, seller y `observedAt`.
6. Cada tipo reemplaza su snapshot dentro de una transacción.
7. La API devuelve conteos y `writesPerformed=false`.
8. Android muestra reclamos abiertos y preguntas sin respuesta.

## API interna

- `POST /v1/integrations/mercadolibre/:accountId/customer-operations/sync`
- `GET /v1/integrations/mercadolibre/:accountId/claims`
- `GET /v1/integrations/mercadolibre/:accountId/questions`

## Frescura

Reclamos y preguntas sin respuesta son señales críticas. El scheduler futuro debe priorizarlas con una meta de frescura de 5 minutos cuando existan eventos abiertos. Hasta incorporar webhooks, el polling debe respetar rate limits, cooldown y deduplicación por hash.

## Verificación

Para Plasticov y Maustian por separado:

1. Ejecute la sincronización.
2. Compare conteos con el panel privado de MercadoLibre.
3. Revise una muestra de IDs y estados.
4. Confirme que no se guardó texto de preguntas ni identidad del comprador.
5. Confirme `writesPerformed=false`.
6. Confirme que sincronizar una cuenta no cambia snapshots de la otra.

## Recuperación

- 401/refresh inválido: la cuenta pasa a `reauthorization-required`.
- 429/5xx: el futuro worker debe aplicar backoff con jitter; una petición manual devuelve error sin borrar el snapshot anterior.
- Payload inválido: se rechaza el ciclo antes de reemplazar snapshots.
- Error durante persistencia: la transacción hace rollback.

## Siguiente slice

Órdenes y reputación se implementan en un PR separado. Mensajes y detalle completo de reclamos quedan fuera hasta definir minimización de PII, retención y políticas de acceso.
