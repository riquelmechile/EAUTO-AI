# SDD 011 — External Perceptual Fingerprint Provider

## Estado

Propuesto para implementación y validación en el mismo vertical slice.

## Problema

Product Identification dispone de semánticas separadas para:

- `sha256-prefix-64`: igualdad exacta de contenido;
- `phash-64`: similitud perceptual mediante distancia Hamming.

Sin embargo, el runtime productivo todavía calcula el fingerprint con el provider determinista de desarrollo, incluso cuando el proveedor visual externo está habilitado. Eso evita falsos positivos criptográficos, pero no permite detectar imágenes visualmente equivalentes con bytes distintos.

## Objetivo

Incorporar un gateway HTTP dedicado que produzca un `phash-64` real y verificable para la imagen previamente validada, manteniendo scope, evidencia, configuración y lifecycle bajo autoridad de EAUTO-AI.

## Separación de responsabilidades

### Fingerprint provider

- calcula únicamente el fingerprint perceptual;
- no propone identidad de producto;
- no busca proveedores;
- no decide duplicados;
- no confirma productos;
- no asigna Product IDs.

### Visual candidate provider

- propone candidatos y similitudes externas;
- no calcula ni controla el fingerprint autoritativo persistido.

### EAUTO-AI

- controla organization/account/upload scope;
- controla endpoint, credenciales, provider name y versión allowlisted;
- crea `evidenceRef`;
- compara fingerprints confirmados;
- aplica thresholds, policy y revisión humana.

## Contrato HTTP

### Request

`POST` al endpoint allowlisted con:

```json
{
  "schemaVersion": "eauto-product-fingerprint-request-v1",
  "organizationId": "maustian",
  "accountId": "plasticov",
  "sourceImageUploadId": "upload-id",
  "objectUri": "s3://private-bucket/object",
  "checksumSha256Base64": "..."
}
```

Headers obligatorios:

- `Authorization: Bearer <server secret>`;
- `Content-Type: application/json`;
- `Idempotency-Key` derivada por el servidor;
- redirects deshabilitados;
- timeout y límite de respuesta.

### Response

```json
{
  "schemaVersion": "eauto-product-fingerprint-response-v1",
  "sourceImageUploadId": "upload-id",
  "checksumSha256Base64": "...",
  "algorithm": "phash-64",
  "version": "phash-64-v1",
  "value": "0101...64 bits"
}
```

El provider debe devolver exactamente el upload ID y checksum de la solicitud. EAUTO-AI rechaza respuestas cruzadas, versiones no allowlisted, algoritmos distintos, valores que no tengan 64 bits binarios, JSON inválido, redirects, respuestas demasiado grandes, timeouts y HTTP no exitoso.

`evidenceRef` nunca es aceptado desde el proveedor: se deriva del upload verificado dentro del servicio de aplicación.

## Configuración

Cuando `CATALOG_ACQUISITION_ENABLED=true`, el runtime requiere además:

- `PRODUCT_FINGERPRINT_PROVIDER_URL`;
- `PRODUCT_FINGERPRINT_PROVIDER_API_KEY`;
- `PRODUCT_FINGERPRINT_PROVIDER_NAME`;
- `PRODUCT_FINGERPRINT_PROVIDER_VERSION`;
- timeout y máximo de bytes.

Producción exige HTTPS sin credenciales embebidas ni fragmentos.

## Modos

- `external-phash-64`: gateway perceptual real;
- `deterministic-sha256-prefix`: desarrollo/test sin fixtures externos;
- `disabled`: producción fail-closed sin providers habilitados.

La API mantiene el modo general de Product Identification y expone además `fingerprintMode` para que Android y auditoría distingan similitud perceptual real de igualdad exacta determinista.

## Seguridad

- No descargar URLs entregadas por el cliente.
- No aceptar endpoint, versión o algoritmo desde Android.
- No aceptar scope ni evidenceRef devueltos por el provider.
- No usar una respuesta si no está ligada al upload y checksum solicitados.
- No degradar silenciosamente a SHA determinista en producción.
- No enviar secretos a hosts distintos del endpoint allowlisted.
- No reintentar mutaciones: este gateway es de lectura/cómputo puro e idempotente.

## Pruebas

- request y headers controlados por servidor;
- normalización de scope y evidenceRef;
- `phash-64` válido;
- rechazo de algoritmo, versión, longitud y caracteres inválidos;
- rechazo de upload/checksum cruzados;
- JSON inválido, HTTP failure, timeout y tamaño máximo;
- configuración fail-closed;
- runtime productivo usa el gateway externo;
- desarrollo conserva SHA exacto explícito;
- respuesta API y Android muestran `fingerprintMode`.

## Fuera de alcance

- Implementar el algoritmo pHash dentro del proceso Node.
- Elegir proveedor comercial concreto.
- Entrenar visión o clasificación de producto.
- Habilitar publicación automática.
