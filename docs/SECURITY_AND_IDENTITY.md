# Seguridad, identidad y alcance

## Principio

El cliente nunca declara sus permisos. El servidor resuelve una identidad, aplica roles y limita cada operación por organización y cuenta.

El código de enrolamiento no es una sesión de uso cotidiano. Solo permite emitir una sesión revocable formada por:

- Access token corto, por defecto 15 minutos.
- Refresh token rotatorio, por defecto 30 días.

En servidor solo se guardan hashes SHA-256. En Android los tokens de sesión se guardan mediante Expo SecureStore, respaldado por Android Keystore.

## Modos

- `AUTH_MODE=disabled`: permitido únicamente en desarrollo o tests. Crea un owner local con alcance wildcard.
- `AUTH_MODE=static-token`: obligatorio en producción. Exige `OPERATOR_TOKENS_JSON` con al menos una identidad de enrolamiento.

## Aprovisionar un operador

1. Generar un secreto aleatorio de alta entropía y guardarlo temporalmente en un gestor de secretos.
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

4. Ingresar el token original una sola vez en la pantalla de enrolamiento Android.
5. Revocar o reemplazar el token de enrolamiento después del aprovisionamiento cuando la política operacional así lo exija.

Nunca versionar, registrar en logs ni incluir el token de enrolamiento dentro del APK.

## Flujo de sesión

```text
Enrollment token
  → POST /v1/auth/session
  → access + refresh
  → SecureStore / Android Keystore
  → access vence
  → POST /v1/auth/refresh
  → rotación atómica de ambos tokens
```

La rotación usa compare-and-swap sobre el hash del refresh anterior. Dos refresh simultáneos no pueden producir dos sesiones activas: solo uno gana y el otro recibe 401.

`POST /v1/auth/logout` revoca access y refresh de la misma sesión.

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

## Configuración

- `SESSION_ACCESS_TTL_MS`: duración máxima del access token.
- `SESSION_REFRESH_TTL_MS`: duración máxima del refresh token.
- `OPERATOR_TOKENS_JSON`: identidades de enrolamiento, con hashes y scopes.

## Operación y límites

- Los refresh tokens se rotan en cada uso.
- Un refresh anterior no puede reutilizarse.
- La revocación es persistente en Postgres.
- Un APK no contiene secretos predeterminados.
- Una sesión inválida o corrupta se elimina del dispositivo y la UI regresa al enrolamiento.
- La siguiente evolución recomendada para distribución multiusuario es un proveedor de identidad con MFA, manteniendo el mismo dominio de roles y scopes.
