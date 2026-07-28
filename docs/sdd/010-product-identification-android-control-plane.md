# SDD 010 — Product Identification Android Control Plane

## Estado

Propuesto para implementación y validación en el mismo vertical slice.

## Contexto

Product Identification ya dispone de dominio determinista, persistencia PostgreSQL, revisión humana terminal, búsqueda de duplicados, runtime y API autenticada. La app Android todavía no permite operar esa capacidad.

La interfaz móvil debe seguir siendo un control plane gobernado. No debe decidir identidad, policy, thresholds, reviewer, timestamps ni proveedores. Tampoco debe publicar productos ni ejecutar mutaciones en MercadoLibre.

## Objetivo

Permitir que un operador autorizado:

1. seleccione Plasticov o Maustian;
2. capture o seleccione una imagen;
3. la cargue mediante el flujo verificado existente;
4. solicite identificación al runtime;
5. inspeccione candidato, alternativas, duplicados, evidencia y policy;
6. confirme o rechace una identificación clara;
7. observe la revisión devuelta por el servidor.

## Requisitos funcionales

### Captura y upload

- Reutilizar `uploadVerifiedSourceImage`.
- Admitir JPEG, PNG y WebP.
- No llamar Product Identification antes de completar la verificación del objeto.
- Reiniciar el resultado anterior cuando cambie la imagen o cuenta.

### Identificación

- Llamar `POST /v1/product-identification/identify` únicamente con `accountId` y `sourceImageUploadId`.
- Mostrar el ID canónico retornado por el servidor.
- Mostrar modo y versión de policy retornados.
- Mostrar estado, razones, candidato seleccionado, alternativas, duplicado bloqueante y referencias de evidencia.
- No interpretar un resultado ambiguo, incompleto, sin match o bloqueado como confirmable.

### Revisión

- Confirmación disponible solo cuando existe candidato seleccionado y `requiresHumanConfirmation=true`.
- Confirmación requiere un `productId` explícito.
- Rechazo requiere motivo explícito.
- El cliente no envía `reviewId`, `reviewerId`, `decidedAt` ni `policyVersion`.
- Una revisión terminal deshabilita nuevas decisiones en la pantalla.

### RBAC y scope

- `owner`, `admin` y `operator` pueden solicitar identificación.
- `owner`, `admin` y `reviewer` pueden revisar.
- Otros roles conservan lectura visual de resultados que ya hayan sido obtenidos en la sesión.
- El servidor sigue siendo autoridad final de permisos y scope.

## Estados de interfaz

- sin imagen;
- imagen lista;
- upload/verificación en curso;
- identificación en curso;
- resultado disponible;
- revisión en curso;
- revisión terminal;
- error controlado.

## Seguridad

- No aceptar URLs de proveedores desde la app.
- No aceptar thresholds ni policy desde la app.
- No generar timestamps de decisión para enviarlos al servidor.
- No convertir el nombre del candidato en una publicación o compra.
- No ocultar `duplicate-blocked`, `incomplete`, `ambiguous` o `no-match`.
- Mantener Plasticov y Maustian como scopes independientes.

## Fuera de alcance

- Implementación local de perceptual hash.
- Investigación web y competencia.
- Resolución de categoría y atributos MercadoLibre.
- Generación de assets.
- Creación o modificación de publicaciones.
- Compra a proveedores.

## Pruebas y gates

- TypeScript estricto de la app Android.
- API client tipado.
- Build móvil incluido en el pipeline raíz.
- Suite completa, PostgreSQL, Docker, object storage y doctors sin regresiones.
