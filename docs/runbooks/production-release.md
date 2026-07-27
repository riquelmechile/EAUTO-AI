# EAUTO-AI — release de producción

## Estado de la release

El repositorio contiene todo el software y la infraestructura necesarios para una instalación productiva de una sola región. Lo único que debe proporcionarse fuera del control de versiones son dominios, credenciales, llaves de cifrado y cuentas de proveedores.

La autonomía productiva permanece deliberadamente en **shadow + aprobación humana**. Aprobar una propuesta no ejecuta una mutación. Las escrituras de MercadoLibre requieren un adapter y una política de acción verificable específicos; no existe un interruptor de “autonomía total”.

## Requisitos

- Linux con Docker Engine y Docker Compose v2.
- DNS A/AAAA para `API_DOMAIN` y `S3_DOMAIN` apuntando al servidor.
- Puertos 80/TCP, 443/TCP y 443/UDP abiertos.
- Cuenta DeepSeek y aplicación MercadoLibre Chile.
- Repositorio Restic externo y cifrado.
- Proyecto Expo/EAS y credenciales de firma Android.

## Configuración

```bash
cp .env.production.example .env.production
```

Reemplace los valores `__REQUIRED__`. Genere secretos independientes y largos. Nunca reutilice la contraseña de PostgreSQL, Redis, MinIO, Restic o el token del operador.

Ejemplos de generación local:

```bash
openssl rand -base64 48
openssl rand -base64 32  # MELI_TOKEN_VAULT_KEY_BASE64: debe decodificar a 32 bytes
```

`OPERATOR_TOKENS_JSON` contiene hashes SHA-256 de tokens, no el token en texto plano. Cree el token fuera del servidor, guarde el valor original en un gestor de secretos y coloque solamente su hash y scope en la configuración.

## Validación previa

```bash
npm ci
npm run check
npm run doctor:production -- --env=.env.production
docker compose --env-file .env.production \
  -f infra/compose/docker-compose.production.yml config --quiet
```

El doctor falla si falta una implementación o un secreto. En CI se utiliza `--template` exclusivamente para comprobar que la plantilla y la infraestructura estén completas.

## Despliegue

```bash
bash scripts/deploy-production.sh
```

El script:

1. valida configuración y secretos;
2. valida Compose;
3. descarga imágenes publicadas;
4. compila MinIO desde el último tag oficial de seguridad y la imagen de backup;
5. arranca PostgreSQL, Redis y almacenamiento;
6. ejecuta migraciones con advisory lock y hashes inmutables;
7. crea el bucket y habilita versionado;
8. arranca API, worker, Caddy y backups;
9. comprueba `https://API_DOMAIN/ready`.

PostgreSQL, Redis y MinIO no publican puertos. Caddy es el único ingreso y emite certificados TLS automáticamente.

## MercadoLibre Chile

Configure en la aplicación MercadoLibre:

- redirect OAuth: `https://API_DOMAIN/v1/integrations/mercadolibre/oauth/callback`;
- webhook: `https://API_DOMAIN/v1/webhooks/mercadolibre`;
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

La workflow `Production release` genera una imagen multi-arquitectura en GHCR y dispara un AAB firmado en EAS. El envío a Play Internal se activa manualmente.

## Rollback

- Aplicación: cambie `EAUTO_IMAGE` a un tag o SHA anterior y ejecute nuevamente el script de despliegue.
- Base de datos: las migraciones son forward-only e inmutables; para corrupción o cambio incompatible use el restore drill en una instalación aislada y documente la decisión.
- Worker: puede detenerse sin perder trabajo; leases vencidos son recuperables.
- Inteligencia: configure `INTELLIGENCE_WORKER_ENABLED=false` para detener razonamiento sin detener API ni ingesta.
- LLM: configure `LLM_ENABLED=false` para bloquear proveedor y conservar auditoría.
- MercadoLibre webhooks: configure `MELI_WEBHOOK_ENABLED=false` si se detecta un incidente de integración.

## Criterio de salida

No declare producción operativa hasta comprobar:

- doctor productivo verde;
- `/health` y `/ready` verdes;
- OAuth Plasticov y Maustian verificados;
- webhook real deduplicado;
- ejecución shadow DeepSeek registrada con cache hit/miss;
- backup externo completo;
- restore drill exitoso;
- AAB instalado en dispositivo real;
- propuestas aprobadas sin ejecución externa accidental.
