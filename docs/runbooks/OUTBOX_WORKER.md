# Runbook: transactional outbox worker

## Objetivo

Procesar eventos de negocio sin perderlos, sin ejecutar dos veces por competencia entre workers y con recuperación explícita de poison messages.

## Arranque

```bash
npm run build:server
npm run start:worker -w @eauto/api
```

En desarrollo:

```bash
npm run dev:worker
```

## Semántica

- La transición de la acción y el evento se escriben en la misma transacción Postgres.
- Cada evento tiene `idempotency_key` única.
- Los workers reclaman lotes mediante `FOR UPDATE SKIP LOCKED`.
- Un lease vencido permite recuperar trabajo abandonado después de un crash.
- Los fallos usan backoff exponencial acotado.
- Al superar `OUTBOX_MAX_ATTEMPTS`, el evento pasa a `dead`.
- Solo `owner` o `admin` pueden reencolar dead letters.

## Diagnóstico

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:3000/v1/operations/outbox

curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:3000/v1/operations/outbox/dead?limit=20"
```

## Reencolar

Investigar primero la causa y corregir el handler o la evidencia. Después:

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:3000/v1/operations/outbox/dead/EVENT_ID/requeue
```

El replay reinicia `attempts`, limpia el error y conserva el mismo evento e idempotency key.

## Incidente

1. Detener el worker si el fallo causa efectos externos incorrectos.
2. Mantener la API en modo fail-closed para writes afectados.
3. Revisar dead letters y logs estructurados.
4. Corregir el handler.
5. Ejecutar tests y smoke en staging.
6. Reencolar un evento de bajo riesgo.
7. Verificar el outcome remoto antes de reanudar el lote.
