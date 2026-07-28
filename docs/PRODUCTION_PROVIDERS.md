# Contratos de proveedores productivos

EAUTO-AI integra proveedores externos mediante gateways HTTP independientes. Las claves y las URLs se configuran fuera de Git. En producción no existe fallback a simuladores.

## Gateway de contenido

Configure:

- `CONTENT_GENERATION_ENABLED=true`;
- `CONTENT_PROVIDER_URL` con HTTPS;
- `CONTENT_PROVIDER_API_KEY`;
- límites y nombre del proveedor mediante las variables `CONTENT_PROVIDER_*`.

### Solicitud

EAUTO-AI envía `POST` JSON con:

- `schemaVersion: eauto-content-request-v1`;
- el brief de producto, cuenta, imagen fuente, stock, costo y canales;
- `requiredKinds: [image, copy]`;
- `optionalKinds: [video]`;
- `privateStorageRequired: true`.

Headers relevantes:

- `Authorization: Bearer <key>`;
- `Idempotency-Key: content:<accountId>:<briefId>`;
- `Content-Type: application/json`.

### Respuesta

```json
{
  "assets": [
    {
      "kind": "image",
      "url": "https://signed-provider-url.example/image.png",
      "model": "image-model-v1",
      "promptVersion": "listing-hero-v3",
      "moderationStatus": "approved",
      "sha256Hex": "optional-64-character-hex"
    },
    {
      "kind": "copy",
      "text": "Título y descripción",
      "model": "copy-model-v1",
      "promptVersion": "listing-copy-v4",
      "moderationStatus": "approved"
    }
  ]
}
```

Debe incluir al menos una imagen y un copy. Los videos son opcionales. EAUTO-AI descarga las URLs HTTPS sin seguir redirects, limita el tamaño, verifica el tipo MIME y el hash opcional, calcula SHA-256 y guarda el contenido en el bucket privado. La URL temporal del proveedor nunca se persiste como asset definitivo.

## Gateway genérico de acciones no-MercadoLibre

El gateway genérico está deshabilitado por defecto:

```dotenv
ACTION_EXECUTION_ENABLED=false
ACTION_PROVIDER_ROUTES_JSON={}
```

Solo puede habilitarse para capabilities que no pertenezcan a MercadoLibre y que tengan su propia política y gate live. Los siguientes action kinds están prohibidos por configuración, runtime y doctor:

- `listing.publish`;
- `listing.update`;
- `price.update`;
- `stock.update`;
- `question.answer`;
- `claim.respond`;
- `ads.update`.

Un ejemplo válido para una capability externa independiente sería:

```json
{
  "social.publish": {
    "executeUrl": "https://actions.example.cl/v1/execute",
    "verifyUrl": "https://actions.example.cl/v1/verify"
  }
}
```

No existe una ruta catch-all. Un tipo no allowlisted falla antes de iniciar una mutación.

### Ejecución

EAUTO-AI envía `POST` a `executeUrl` con:

- `operation: execute`;
- ID, cuenta, tipo, target y cambios exactos;
- rationale, riesgo, política, evidence bundle ID y expiración.

Headers:

- `Authorization: Bearer <key>`;
- `Idempotency-Key: <actionId>:execute`.

El JSON de respuesta se registra dentro del receipt de ejecución.

### Verificación

Después de ejecutar, EAUTO-AI realiza otro `POST` a `verifyUrl` con:

- el mismo action envelope;
- `operation: verify`;
- `Idempotency-Key: <actionId>:verify`.

La respuesta debe contener:

```json
{
  "verified": true,
  "observedState": {
    "field": "remote value observed after execution"
  }
}
```

Sin `verified: true`, la acción no alcanza estado `verified`.

## MercadoLibre `question.answer`

La única escritura MercadoLibre modelada es un adapter dedicado; nunca debe configurarse en `ACTION_PROVIDER_ROUTES_JSON`.

Permanece apagado en la plantilla:

```dotenv
MELI_QUESTION_ANSWER_ENABLED=false
MELI_QUESTION_ANSWER_ACCOUNT_ID=
MELI_QUESTION_ANSWER_POLICY_VERSION=mercadolibre-question-answer-v1
```

Después de completar los gates live del issue #41, la primera activación exige:

```dotenv
MELI_QUESTION_ANSWER_ENABLED=true
MELI_QUESTION_ANSWER_ACCOUNT_ID=plasticov
```

El runtime:

1. obtiene la credencial cifrada de PostgreSQL;
2. rota el token bajo lease cuando está próximo a expirar;
3. verifica que la pregunta pertenezca al seller OAuth esperado;
4. acepta únicamente `answer.text` desde `null` a un texto aprobado de hasta 2.000 caracteres;
5. publica en el host oficial fijo de MercadoLibre;
6. persiste un receipt sanitizado;
7. vuelve a consultar la pregunta y compara el hash de la respuesta y el estado remoto.

Maustian no está admitida en el primer rollout. Todas las otras escrituras MercadoLibre continúan bloqueadas.

## Seguridad operacional

- HTTPS obligatorio en producción.
- Prohibidas credenciales embebidas en URLs.
- Timeout y máximo de bytes configurables.
- Respuestas JSON inválidas se rechazan.
- La aprobación humana debe existir y coincidir con el hash actual de la acción.
- Una propuesta shadow aprobada no se convierte automáticamente en `BusinessAction`.
- Cada ejecución y verificación queda en la cadena de receipts.
- Los tokens MercadoLibre nunca se incluyen en receipts ni logs.
- Una operación externa ambigua termina en `uncertain`; no existe reintento ciego.

## Pruebas previas

```bash
npm run check
npm audit --audit-level=high
npm run smoke:mercadolibre-question-answer
npm run smoke:production-runtime
npm run doctor:production -- --env=.env.production
```

El smoke de producción confirma que el gateway genérico no puede ejecutar MercadoLibre y que la única ruta dedicada se conecta al almacén OAuth rotatorio sin realizar una mutación live.
