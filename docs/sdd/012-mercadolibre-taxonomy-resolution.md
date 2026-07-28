# SDD 012 — Governed MercadoLibre Chile Taxonomy Resolution

## Estado

Propuesto para implementación y validación en el mismo vertical slice.

## Contexto

EAUTO-AI puede capturar una foto, identificar un producto, persistir la evidencia y exigir confirmación humana. El siguiente gate antes de preparar una publicación es determinar una categoría válida de MercadoLibre Chile y conocer los atributos exigidos por esa categoría.

MercadoLibre recomienda predecir categorías mediante `/sites/{SITE_ID}/domain_discovery/search` y consultar los atributos de una categoría mediante `/categories/{CATEGORY_ID}/attributes`. La respuesta del predictor es una recomendación ordenada, no una autorización para publicar.

## Objetivo

Resolver y persistir una propuesta de taxonomía read-only a partir de una identificación de producto previamente confirmada por una persona, y exigir una segunda revisión humana antes de declarar la categoría seleccionada.

## Flujo

1. El operador solicita resolver taxonomía indicando `accountId` e `identificationId`.
2. El servidor carga la identificación dentro del scope organización/cuenta.
3. El servidor exige una review terminal `confirmed` con `productId`.
4. El servidor construye una consulta en español desde el candidato confirmado.
5. El servicio de MercadoLibre obtiene un access token vigente de la cuenta correcta.
6. Consulta el predictor para el site fijo `MLC`, con `limit=3` y `target=core`.
7. Para cada categoría predicha consulta sus atributos.
8. Normaliza y persiste una resolución inmutable con evidencia, source hashes y policy version.
9. Un reviewer selecciona una de las categorías propuestas o rechaza la resolución.
10. La decisión terminal queda persistida. No se crea ni modifica una publicación.

## Autoridad

### Código EAUTO-AI

Controla:

- organización y cuenta;
- seller connection y access token;
- site `MLC`;
- límite y target del predictor;
- query derivada del candidato confirmado;
- ID/hash de la resolución;
- policy version;
- reviewer y timestamps;
- lifecycle terminal;
- persistencia y auditoría.

### MercadoLibre

Aporta únicamente:

- predicciones de dominio/categoría;
- atributos sugeridos por el predictor;
- atributos disponibles y tags de obligatoriedad para cada categoría.

### Persona

Confirma o rechaza la categoría propuesta. Ningún modelo ni proveedor puede realizar esa confirmación.

## Modelo

### Prediction

- `domainId`, `domainName`;
- `categoryId`, `categoryName`;
- `suggestedAttributes` del predictor;
- `categoryAttributes` normalizados;
- `requiredAttributeIds`;
- `catalogRequiredAttributeIds`;
- `evidenceRefs`;
- `sourceHash`.

### Resolution

- scope y `identificationId`;
- `productId` confirmado;
- query usada;
- máximo tres predicciones ordenadas;
- estado `resolved-pending-review` o `no-prediction`;
- categoría propuesta igual a la primera predicción;
- evidence refs y policy version;
- `requiresHumanReview`;
- `evaluatedAt`.

### Review

- decisión `confirmed` o `rejected`;
- categoría seleccionada, que debe existir dentro de las predicciones si se confirma;
- reviewer y timestamp controlados por servidor;
- motivo obligatorio al rechazar;
- lifecycle terminal por resolución.

## Endpoints

- `POST /v1/product-taxonomy/resolve`
- `GET /v1/product-taxonomy/:id?accountId=...`
- `POST /v1/product-taxonomy/:id/review`

Permisos existentes:

- resolver: `catalog.acquire`;
- leer: `catalog.read`;
- revisar: `catalog.review`.

## Invariantes

- Solo una Product Identification confirmada puede iniciar el flujo.
- La resolución no acepta título, query, site, limit, target, provider URL, policy ni timestamp desde el cliente.
- Todos los IDs de dominio y categoría deben pertenecer a Chile (`MLC`).
- Una categoría seleccionada debe estar incluida en la resolución persistida.
- Los atributos se tratan como metadata read-only; no se consideran completados.
- Una review contradictoria produce conflicto.
- Las respuestas de otra cuenta u organización se rechazan.
- Errores 401 de MercadoLibre conservan el lifecycle de reautorización existente.
- No se crea, actualiza ni publica un ítem.

## Persistencia

Migración 031:

- `product_taxonomy_resolutions`;
- `product_taxonomy_reviews`;
- scope por organización/cuenta;
- FK hacia `product_identification_results`;
- JSONB inmutable;
- unique terminal review por resolución;
- indexes de lectura por cuenta, producto y fecha.

## Pruebas

- dominio: ordering, scope MLC, required attributes, selección válida y review terminal;
- application: requiere identificación confirmada y no acepta review extranjera;
- HTTP client: predictor MLC, limit/target controlados, attributes y normalización estricta;
- repositories in-memory/PostgreSQL: idempotencia, scope y conflicto terminal;
- API: RBAC y metadata server-owned;
- smoke PostgreSQL y runtime productivo;
- regresión completa de Docker, MinIO y doctors.

## Fuera de alcance

- completar valores de atributos;
- validar compatibilidades de autopartes;
- investigar precios o competidores;
- crear publicaciones;
- activar catálogo de MercadoLibre;
- ejecutar escrituras externas.
