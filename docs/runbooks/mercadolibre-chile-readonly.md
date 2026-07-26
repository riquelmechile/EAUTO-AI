# MercadoLibre Chile — conexión dual-account read-only

## Alcance

Este slice conecta **Plasticov** y **Maustian** como cuentas independientes de MercadoLibre Chile (`MLC`). Hereda:

- de MSL: seller IDs explícitos, identidad OAuth obligatoria, refresh lazy por cuenta, cifrado AES-256-GCM y write gate fail-closed;
- de kiiess: state consumible, runtime desacoplado, readiness y snapshots operacionales;
- del libro Gentleman Programming: arquitectura hexagonal, contratos, contexto acotado y confianza verificable.

No implementa publicaciones, precios, promociones, Ads, reclamos ni ninguna otra mutación.

## Configuración

1. Cree una aplicación de MercadoLibre y registre exactamente el callback del backend.
2. Configure `MELI_ENABLED=true`.
3. Configure `MELI_CLIENT_ID`, `MELI_CLIENT_SECRET` y `MELI_REDIRECT_URI`.
4. Configure los seller IDs reales:
   - `MELI_PLASTICOV_SELLER_ID`
   - `MELI_MAUSTIAN_SELLER_ID`
5. Genere una llave aleatoria de 32 bytes y guárdela codificada en Base64 como `MELI_TOKEN_VAULT_KEY_BASE64`.
6. En producción el callback debe usar HTTPS.

Los seller IDs deben ser diferentes. El callback valida que `/users/me` pertenezca a `MLC` y coincida con el seller esperado para la cuenta seleccionada.

## Flujo

1. Un owner/admin solicita autorización para `plasticov` o `maustian`.
2. El backend genera state y PKCE; solo guarda hash de state y verifier cifrado.
3. MercadoLibre redirige al callback.
4. El backend consume state de una sola vez, intercambia el código y consulta `/users/me`.
5. Si site o seller no coinciden, no se guarda ningún token.
6. Access y refresh tokens quedan cifrados con AES-256-GCM y AAD ligado a account/seller.
7. La sincronización lee publicaciones privadas y reemplaza el snapshot de esa cuenta en una transacción.
8. El access token se renueva solo cuando está por vencer. Un lease evita refresh concurrentes.
9. `invalid_grant` cambia la conexión a `reauthorization-required`.

## API

- `POST /v1/integrations/mercadolibre/:accountId/authorize`
- `GET /v1/integrations/mercadolibre/oauth/callback`
- `GET /v1/integrations/mercadolibre/:accountId/status`
- `POST /v1/integrations/mercadolibre/:accountId/sync`
- `GET /v1/integrations/mercadolibre/:accountId/listings`

El callback es público porque MercadoLibre lo invoca desde el navegador, pero solo acepta un state válido, no vencido y no reutilizado.

## Seguridad

- Nunca registrar access token, refresh token, client secret, verifier o código OAuth.
- Nunca enviar secretos a Android.
- Nunca aceptar seller ID desde el callback o desde el cliente.
- Nunca mezclar snapshots entre Plasticov y Maustian.
- Mantener `MELI_ENABLED=false` hasta configurar staging.
- Mantener todas las mutaciones bloqueadas mediante `assertMercadoLibreWriteDisabled`.

## Verificación operativa

Para cada cuenta:

1. Autorizar con la sesión de esa cuenta.
2. Verificar que status muestre `siteId=MLC` y el seller configurado.
3. Ejecutar sync.
4. Comparar cantidad y muestra de IDs con el panel privado de MercadoLibre.
5. Confirmar que la otra cuenta no cambió.
6. Forzar expiración en staging y confirmar refresh rotatorio.
7. Revocar el refresh token en staging y confirmar `reauthorization-required`.

## Recuperación

- `mercadolibre-invalid-state`: reiniciar el flujo OAuth; no reutilizar la URL anterior.
- `mercadolibre-seller-mismatch`: revisar seller ID y que se haya iniciado sesión en la cuenta correcta.
- `mercadolibre-site-mismatch`: la cuenta no pertenece a MercadoLibre Chile.
- `mercadolibre-refresh-in-progress`: reintentar después del lease; no iniciar otro worker manualmente.
- `mercadolibre-reauthorization-required`: realizar OAuth nuevamente solo para esa cuenta.

## Rollback

Deshabilite `MELI_ENABLED`, reinicie API/worker y revierta la migración solo si no necesita conservar el historial. Los snapshots y tokens cifrados no son utilizados por ningún write path.
