# Runbook: cargas verificadas de imágenes fuente

## Objetivo

Transferir fotos desde Android a almacenamiento S3-compatible sin enviar secretos al dispositivo ni aceptar archivos distintos a los declarados.

## Flujo

1. Android obtiene JPEG, PNG o WebP desde cámara o galería.
2. La app lee los bytes y calcula SHA-256.
3. Solicita `POST /v1/uploads/source-images` con cuenta, MIME, tamaño y checksum.
4. El backend valida permisos, tamaño máximo y cuenta.
5. Genera una URL `PutObject` firmada con expiración corta.
6. Android sube directamente con `Content-Type` y `x-amz-checksum-sha256` firmados.
7. La app llama `POST /v1/uploads/source-images/:id/complete`.
8. El backend ejecuta `HeadObject` por red privada y compara tamaño, MIME y checksum.
9. Solo un upload `verified` puede alimentar `POST /v1/content/launches`.

## Endpoints público e interno

- `OBJECT_STORAGE_PUBLIC_ENDPOINT`: host firmado y accesible desde Android. Debe usar HTTPS en producción.
- `OBJECT_STORAGE_INTERNAL_ENDPOINT`: host privado usado por API para inspección y verificación.

No reescriba el hostname de una URL firmada después de generarla: forma parte de la firma.

## Desarrollo Android Emulator

Compose usa por defecto `http://10.0.2.2:9000` como endpoint público y `http://minio:9000` como endpoint interno.

Para un teléfono físico configure antes de levantar Compose:

```bash
export OBJECT_STORAGE_PUBLIC_ENDPOINT=http://IP_DE_TU_PC:9000
```

En producción use un dominio HTTPS dedicado, por ejemplo `https://uploads.example.com`, y mantenga MinIO privado para inspección interna.

## Límites

- MIME permitidos: JPEG, PNG y WebP.
- Máximo predeterminado: 10.000.000 bytes.
- Vigencia predeterminada de la URL: 300 segundos.
- Bucket privado; no se habilita lectura anónima.
- Object key segmentada por organización y cuenta.

## Smoke real

```bash
docker compose -f infra/compose/docker-compose.yml up -d minio minio-init
npm run build:server
npm run smoke:object-storage
```

El smoke hace un PUT firmado y verifica tamaño, MIME y SHA-256 por `HeadObject`.

## Incidentes

- `403 SignatureDoesNotMatch`: revisar endpoint público, reloj, headers exactos y no alterar la URL.
- `checksum does not match`: descartar el upload; no crear lanzamiento.
- `object not found`: comprobar expiración, conectividad y que el PUT terminó antes del complete.
- URL pública inaccesible desde Android: configurar IP o dominio alcanzable desde el teléfono.
