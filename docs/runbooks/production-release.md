# EAUTO-AI — release de producción

## Estado de la release

El repositorio contiene el software y la infraestructura necesarios para una instalación productiva de una sola región. Fuera del control de versiones deben proporcionarse dominios, credenciales, llaves de cifrado, cuentas de proveedores y el digest inmutable de la imagen publicada.

La autonomía productiva permanece deliberadamente en **shadow + aprobación humana**. Aprobar una propuesta no ejecuta una mutación. Las escrituras externas requieren un adapter y una política de acción verificable específicos; no existe un interruptor de “autonomía total”.

## Requisitos

- Linux con Docker Engine y Docker Compose v2.
- DNS A/AAAA para `API_DOMAIN` y `S3_DOMAIN` apuntando al servidor.
- Puertos 80/TCP, 443/TCP y 443/UDP abiertos.
- Cuenta DeepSeek y aplicación MercadoLibre Chile.
- Repositorio Restic externo y cifrado.
- Proyecto Expo/EAS y credenciales de firma Android.
- Digest GHCR producido por la workflow de release.

## Configuración

```bash
cp .env.production.example .env.production
```

Reemplace todos los valores `__REQUIRED__`. Genere secretos independientes y largos. Nunca reutilice la contraseña de PostgreSQL, MinIO, Restic o el token del operador.

Ejemplos de generación local:

```bash
openssl rand -base64 48
openssl rand -base64 32  # MELI_TOKEN_VAULT_KEY_BASE64: debe decodificar a 32 bytes
```

`OPERATOR_TOKENS_JSON` contiene hashes SHA-256 de tokens, no el token en texto plano. Cree el token fuera del servidor, guarde el valor original en un gestor de secretos y coloque solamente su hash y scope en la configuración.

### Imagen inmutable

`EAUTO_IMAGE` debe usar el digest completo publicado por GHCR:

```text
EAUTO_IMAGE=ghcr.io/riquelmechile/eauto-ai@sha256:<64 caracteres hexadecimales>
```

No use `latest`, tags de versión ni tags `sha-*`: los tags pueden moverse. El despliegue y el doctor rechazan cualquier referencia que no sea un digest.

### PostgreSQL

`DATABASE_URL` es la autoridad exacta usada por API, worker y migrador. No se reconstruye desde otras variables. Si la contraseña contiene `@`, `:`, `/`, `?`, `#`, `%` u otros caracteres reservados, codifíquelos con percent-encoding dentro de la URL.

Ejemplo conceptual:

```text
POSTGRES_PASSWORD=contraseña:compleja
DATABASE_URL=postgres://eauto:contrase%C3%B1a%3Acompleja@postgres:5432/eauto
```

`POSTGRES_PASSWORD` conserva el valor real para el contenedor PostgreSQL; `DATABASE_URL` contiene su representación codificada como URL.

## Validación previa

```bash
npm ci
npm run check
npm run doctor:production -- --env=.env.production
docker compose --env-file .env.production \
  -f infra/compose/docker-compose.production.yml config --quiet
```

El doctor falla si falta una implementación, un secreto, una URL válida o un digest inmutable. También detecta placeholders embebidos dentro de URLs. En CI se utiliza `--template` exclusivamente para comprobar que la plantilla y la infraestructura estén completas.

## Despliegue

```bash
bash scripts/deploy-production.sh
```

El script:

1. valida configuración, secretos, `DATABASE_URL` y digest;
2. valida Compose;
3. descarga obligatoriamente la imagen exacta y las imágenes base;
4. detiene el proceso ante cualquier error de pull, evitando reutilizar una imagen local antigua;
5. compila MinIO desde el tag oficial fijado y la imagen de backup;
6. arranca PostgreSQL y almacenamiento;
7. ejecuta migraciones con advisory lock y hashes inmutables;
8. crea el bucket y habilita versionado;
9. arranca API, worker, Caddy y backups;
10. comprueba `https://API_DOMAIN/ready` y registra el digest desplegado.

PostgreSQL y MinIO no publican puertos. Caddy es el único ingreso y emite certificados TLS automáticamente.

## MercadoLibre Chile

Configure en la aplicación MercadoLibre:

- redirect OAuth: `https://API_DOMAIN/v1/integrations/mercadolibre/oauth/callback`;
- webhook: `https://API_DOMAIN/v1/webhooks/mercadolibre?token=<MELI_WEBHOOK_TOKEN>`;
- sitio esperado: `MLC`;
- seller ID Plasticov;
- seller ID Maustian.

Conecte y verifique cada cuenta de forma independiente desde Android. Nunca intercambie los seller IDs para “probar”; el backend bloquea cualquier mismatch.

## DeepSeek e inteligencia

Después de definir `LLM_API_KEY`, `LLM_ENABLED=true` e `INTELLIGENCE_WORKER_ENABLED=true`, el worker puede procesar work orders admitidos. Continúan vigentes:

- evidence pack fresco y exacto;
- memoria consultiva scopeada;
- utilidad esperada y presupuesto;
- cadena CEO → director → especialista;
- JSON validado;
- citas limitadas al evidence pack;
- ninguna herramienta de escritura;
- propuesta pendiente de aprobación.

## Backups

El contenedor `backup` ejecuta diariamente:

- `pg_dump` en formato custom;
- copia verificada del bucket;
- backup Restic cifrado en un repositorio externo;
- retención diaria, semanal y mensual;
- verificación parcial de datos.

Prueba manual:

```bash
docker compose --env-file .env.production \
  -f infra/compose/docker-compose.production.yml \
  run --rm -e BACKUP_ONCE=true backup
```

### Restore drill

Realícelo primero en una instalación aislada. Detenga API y worker. Después:

```bash
docker compose --env-file .env.production \
  -f infra/compose/docker-compose.production.yml \
  run --rm --entrypoint /usr/local/bin/eauto-restore \
  -e CONFIRM_RESTORE=YES backup
```

El restore se niega sin confirmación explícita, verifica Restic, restaura PostgreSQL con `--exit-on-error` y sincroniza los objetos.

## Android

Secrets de GitHub requeridos:

- `EXPO_TOKEN`;
- `EAS_PROJECT_ID`;
- `EXPO_PUBLIC_API_URL` con HTTPS;
- `GOOGLE_SERVICE_ACCOUNT_KEY_JSON` solamente para envío automático a Google Play.

La workflow `Production release` genera una imagen multi-arquitectura en GHCR y dispara un AAB firmado en EAS. El envío a Play Internal se activa manualmente. Copie el digest publicado por el job de contenedor a `EAUTO_IMAGE`; no copie solamente el tag.

## Rollback

- Aplicación: cambie `EAUTO_IMAGE` al digest anterior conocido y ejecute nuevamente el script. El pull es obligatorio y no utiliza una copia local silenciosamente.
- Base de datos: las migraciones son forward-only e inmutables. El script no intenta rollback automático si readiness falla. Para corrupción o cambio incompatible use el restore drill en una instalación aislada y documente la decisión.
- Worker: puede detenerse sin perder trabajo; leases vencidos son recuperables.
- Inteligencia: configure `INTELLIGENCE_WORKER_ENABLED=false` para detener razonamiento sin detener API ni ingesta.
- LLM: configure `LLM_ENABLED=false` para bloquear proveedor y conservar auditoría.
- MercadoLibre webhooks: configure `MELI_WEBHOOK_ENABLED=false` si se detecta un incidente de integración.

## Criterio de salida

No declare producción operativa hasta comprobar:

- doctor productivo verde;
- digest de `EAUTO_IMAGE` registrado;
- `/health` y `/ready` verdes;
- OAuth Plasticov y Maustian verificados;
- webhook real autenticado y deduplicado;
- ejecución shadow DeepSeek registrada con cache hit/miss;
- backup externo completo;
- restore drill exitoso;
- AAB instalado en dispositivo real;
- propuestas aprobadas sin ejecución externa accidental.
