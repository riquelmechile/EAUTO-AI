# Contratos de proveedores productivos

EAUTO-AI integra proveedores externos mediante dos gateways HTTP independientes. Las claves y las URLs se configuran fuera de Git. En producción no existe fallback a simuladores.

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

## Gateway de acciones

Configure:

- `ACTION_EXECUTION_ENABLED=true`;
- `ACTION_PROVIDER_API_KEY`;
- `ACTION_PROVIDER_ROUTES_JSON` con una entrada explícita por `BusinessAction.kind`.

Ejemplo:

```json
{
  "price.update": {
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

## Seguridad operacional

- HTTPS obligatorio en producción.
- Prohibidas credenciales embebidas en URLs.
- Timeout y máximo de bytes configurables.
- Respuestas JSON inválidas se rechazan.
- La aprobación humana debe existir y coincidir con el hash actual de la acción.
- Una propuesta shadow aprobada no se convierte automáticamente en `BusinessAction`.
- Cada ejecución y verificación queda en la cadena de receipts.

## Pruebas previas

```bash
npm run check
npm run smoke:production-runtime
npm run doctor:production -- --env=.env.production
```

El smoke confirma que el runtime productivo usa gateways externos y no dobles de desarrollo.
