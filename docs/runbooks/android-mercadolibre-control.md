# Android — centro de control MercadoLibre Chile

## Objetivo

Permitir que el CEO conecte, reautorice, sincronice y consulte **Plasticov** y **Maustian** desde EAUTO-AI para Android sin introducir secretos de MercadoLibre en el APK.

## Flujo de autorización

1. Android solicita al backend una URL de autorización para una cuenta concreta.
2. El backend genera state y PKCE, cifra el verifier y devuelve únicamente la URL pública.
3. Android abre la URL mediante `expo-web-browser` y Chrome Custom Tabs.
4. MercadoLibre Chile redirige al callback HTTPS del backend.
5. El backend consume state, intercambia el código, valida `site_id=MLC` y seller ID.
6. Access y refresh tokens quedan cifrados en el servidor.
7. El backend redirige a `eautoai://mercadolibre/oauth-complete` con datos no sensibles.
8. Android valida scheme, host, path, cuenta y `siteId=MLC`.
9. Android consulta nuevamente el estado al backend; no confía solo en el deep link.

## Seguridad

- El esquema móvil está fijado en código para impedir open redirects.
- El deep link no contiene code, state, access token ni refresh token.
- El client secret nunca se distribuye a Android.
- Plasticov y Maustian se muestran y sincronizan por separado.
- Un viewer puede consultar, pero no conectar ni sincronizar.
- Un operator puede sincronizar, pero no conectar.
- Owner/admin pueden conectar y reautorizar.
- Todas las mutaciones siguen bloqueadas.

## Prueba en Android

El deep link requiere un development build o APK/AAB; Expo Go no ofrece una URL estable para este flujo.

1. Compile e instale la app con el scheme `eautoai`.
2. Inicie sesión en EAUTO-AI con un owner/admin.
3. Abra la pestaña `MercadoLibre`.
4. Conecte Plasticov e inicie sesión en la cuenta correcta.
5. Confirme que vuelve a EAUTO-AI y aparece `MLC` con el seller esperado.
6. Repita con Maustian.
7. Sincronice cada cuenta y compare una muestra de publicaciones.
8. Confirme que la interfaz indica `SOLO LECTURA` y que el backend devuelve `writesPerformed=false`.

## Fallos esperados

- Cancelación del navegador: no cambia la conexión.
- Deep link inesperado: la app rechaza el resultado y vuelve a consultar el servidor.
- Seller equivocado: el backend no guarda tokens.
- Refresh revocado: la cuenta muestra `Requiere reautorización`.
- Rol insuficiente: el backend devuelve 403 y la UI deshabilita el control correspondiente.

## Build

La incorporación del scheme es configuración nativa. Después de cambiar `app.json`, genere un nuevo development build o APK; una actualización JavaScript no modifica el AndroidManifest instalado.
