# Credenciales de producción — preparación y carga

## Objetivo

Dejar el runtime listo para recibir credenciales sin versionar secretos, imprimir valores sensibles ni habilitar escrituras MercadoLibre accidentalmente.

## 1. Generar secretos internos

Ejecute desde la raíz:

```bash
npm run credentials:generate -- --output=.env.production
```

Opciones:

```bash
npm run credentials:generate -- \
  --output=.env.production \
  --organization=maustian \
  --operator=sebastian \
  --accounts=plasticov,maustian
```

El generador crea:

- contraseña PostgreSQL y `DATABASE_URL` consistente;
- usuario/contraseña MinIO y claves S3 coincidentes;
- token de enrolamiento del owner y su hash en `OPERATOR_TOKENS_JSON`;
- clave AES de 32 bytes para el vault OAuth MercadoLibre;
- token secreto para webhooks;
- contraseña Restic.

Los archivos se crean con permisos `0600` y el comando rechaza sobrescribirlos, salvo que se entregue `--force` explícitamente.

El token original del operador queda en:

```text
.env.production.operator-token
```

Úselo una sola vez para enrolar Android. El servidor recibe únicamente el hash incluido en `OPERATOR_TOKENS_JSON`.

## 2. Completar credenciales externas

El generador deja `__REQUIRED__` donde el valor debe venir de un proveedor o despliegue real:

### Infraestructura

- `API_DOMAIN` y `S3_DOMAIN`;
- `EXPO_PUBLIC_API_URL`;
- `EAS_PROJECT_ID`;
- digest inmutable `EAUTO_IMAGE`.

### IA y contenido

- `LLM_API_KEY`;
- URL/clave del proveedor de contenido;
- URL/clave de búsqueda visual;
- URL/clave de fingerprint perceptual;
- rutas/clave de catálogos de proveedor.

### MercadoLibre Chile

- `MELI_CLIENT_ID`;
- `MELI_CLIENT_SECRET`;
- `MELI_PLASTICOV_SELLER_ID`;
- `MELI_MAUSTIAN_SELLER_ID`;
- `MELI_APPLICATION_ID`;
- redirect URI HTTPS registrado exactamente en la aplicación.

`MELI_PRODUCT_ADS_ADVERTISER_IDS_JSON={}` es válido para el primer discovery. Si MercadoLibre devuelve más de un advertiser MLC, el sync se bloquea y debe fijarse el mapping explícito.

### Backup externo

- `RESTIC_REPOSITORY`;
- `RESTIC_AWS_ACCESS_KEY_ID`;
- `RESTIC_AWS_SECRET_ACCESS_KEY`.

## 3. Validar sin mostrar secretos

Durante preparación:

```bash
npm run credentials:doctor -- --template --env=.env.production.example
```

Cuando los valores reales estén cargados:

```bash
npm run credentials:doctor -- --env=.env.production
npm run doctor:production -- --env=.env.production
```

El doctor solo muestra nombres y estados. Valida, entre otros:

- placeholders pendientes;
- HTTPS y hostnames;
- digest GHCR inmutable;
- UUID de EAS;
- URL PostgreSQL y coincidencia de contraseña;
- hashes SHA-256, roles y scopes de operadores;
- claves MinIO coincidentes;
- vault OAuth base64 de exactamente 32 bytes;
- IDs numéricos y sellers distintos;
- token webhook mínimo;
- advertiser mapping;
- rollout Plasticov-only de Product Ads y `question.answer`.

## 4. Estado seguro inicial

Mantenga:

```dotenv
ACTION_EXECUTION_ENABLED=false
MELI_QUESTION_ANSWER_ENABLED=false
MELI_QUESTION_ANSWER_ACCOUNT_ID=
```

Product Ads puede permanecer activo porque es read-only:

```dotenv
MELI_PRODUCT_ADS_ENABLED=true
MELI_PRODUCT_ADS_ACCOUNT_ID=plasticov
```

## 5. Validación completa antes de desplegar

```bash
npm ci
npm audit --audit-level=high
npm run check
npm run credentials:doctor -- --env=.env.production
npm run doctor:production -- --env=.env.production
npm run smoke:production-runtime

docker compose \
  --env-file .env.production \
  -f infra/compose/docker-compose.production.yml \
  config --quiet
```

Después se puede ejecutar el runbook de release. La presencia de credenciales no habilita por sí sola autonomía ni escrituras externas.

## Reglas de custodia

- No pegar `.env.production` en issues, PRs, Slack ni chats.
- No incluir secretos en el APK.
- No registrar tokens OAuth o API keys en logs.
- Mantener copias cifradas en un gestor de secretos.
- Rotar inmediatamente cualquier valor expuesto.
- Conservar el token de enrolamiento solo hasta completar el enrolamiento del dispositivo.
