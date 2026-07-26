# Seguridad, identidad y alcance

## Principio

El cliente nunca declara sus permisos. El servidor resuelve una identidad a partir de un Bearer token, aplica roles y limita cada operación por organización y cuenta.

## Modos

- `AUTH_MODE=disabled`: permitido únicamente en desarrollo o tests. Crea un actor owner local con alcance wildcard.
- `AUTH_MODE=static-token`: obligatorio en producción. Exige `OPERATOR_TOKENS_JSON` con al menos una identidad.

## Crear un token

1. Generar un secreto aleatorio de alta entropía y guardarlo en un gestor de secretos.
2. Calcular el hash sin registrar el token:

```bash
node scripts/hash-operator-token.mjs "TOKEN"
```

3. Configurar solamente el SHA-256 en el servidor:

```json
[
  {
    "id": "sebastian",
    "tokenHash": "SHA256_HEX",
    "organizationId": "maustian",
    "roles": ["owner"],
    "accountIds": ["plasticov", "maustian"]
  }
]
```

4. Entregar el token original a la app mediante un canal seguro. Nunca versionarlo, registrarlo en logs ni incluirlo en un APK público.

## Roles

- `owner`: todos los permisos y recuperación operacional.
- `admin`: administración completa delegada.
- `operator`: lectura, contenido, propuestas y revisión; no aprueba ni ejecuta.
- `reviewer`: revisión y aprobación; no ejecuta.
- `viewer`: solo lectura.
- `agent`: propone y crea contenido; no aprueba ni ejecuta.

## Aislamiento

Una operación sobre una cuenta requiere simultáneamente:

1. Misma `organizationId`.
2. Cuenta presente en `accountIds` o wildcard administrativo.
3. Permiso asociado al rol.

Los recursos fuera del alcance se responden como `404` para reducir enumeración entre tenants.

## Límites actuales

Los tokens estáticos sirven para operación controlada y pruebas privadas. Antes de distribución amplia deben reemplazarse o complementarse con login, rotación, expiración, revocación, almacenamiento Android Keystore y sesiones de corta duración. El dominio de permisos y alcance permanece válido para ese cambio de adaptador.
