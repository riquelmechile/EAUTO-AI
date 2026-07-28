# Roadmap

> Estado actualizado después de la auditoría técnica del 28 de julio de 2026.

## Leyenda

- ✅ implementado y verificado;
- 🟡 implementado parcialmente o pendiente de integración live;
- 🔒 bloqueado intencionalmente hasta cumplir gates de seguridad;
- ⬜ planificado.

## Resumen

| Fase                         | Estado | Objetivo                                                                      |
| ---------------------------- | :----: | ----------------------------------------------------------------------------- |
| F0 — Fundación de dominio    |   ✅   | Contratos, evidencia, políticas, acciones y recibos verificables              |
| F1 — Fundación productiva    |   ✅   | PostgreSQL, workers, almacenamiento, seguridad, CI y despliegue inmutable     |
| F2 — MercadoLibre read plane |   🟡   | Conectar cuentas reales y consolidar la verdad operacional                    |
| F3 — Agent OS gobernado      |   🟡   | Operar agentes con contratos, skills, sesiones, presupuestos y scorecards     |
| F4 — Content Studio real     |   🟡   | Identificar productos y conectar generación externa verificable               |
| F5 — Product Launch          |   🟡   | Foto → investigación → economics → assets → publicación preparada             |
| F6 — Autonomía limitada      |   🔒   | Promover capacidades solo con evidencia, presupuesto, rollback y outcomes     |
| F7 — Expansión comercial     |   ⬜   | Ecommerce propio, proveedores, Ads, redes sociales y marketplaces adicionales |

## F0 — Fundación de dominio ✅

- [x] Dominio puro, independiente de frameworks y proveedores.
- [x] Dinero, evidencia, objetivos, políticas y autonomía.
- [x] Máquina de estados de acciones fail-closed.
- [x] Estado `uncertain` para resultados externos no confirmados.
- [x] Evidence gate y policy hash.
- [x] Receipts append-only encadenados mediante SHA-256.
- [x] Prompt compiler con prefijo estable para caché.
- [x] Wake policy por señal y utilidad esperada.
- [x] Costeo explícito de cache hit, cache miss y output.

## F1 — Fundación productiva ✅

- [x] Monorepo npm con TypeScript estricto.
- [x] API Fastify y app Android Expo/React Native.
- [x] Autenticación, RBAC y scope por organización y cuenta.
- [x] PostgreSQL como fuente autoritativa.
- [x] Migraciones idempotentes verificadas sobre una base limpia.
- [x] Constraints multi-tenant y protección contra colisiones entre cuentas.
- [x] Transactional outbox, leases, retries, dead-letter y replay administrativo.
- [x] Worker 24/7 recuperable después de reinicios.
- [x] MinIO privado, versionado y URLs firmadas.
- [x] Docker Compose, Caddy y runtime productivo read-only.
- [x] Imágenes productivas fijadas mediante digest inmutable.
- [x] CI con formato, typecheck, lint, tests, build, PostgreSQL, Docker, MinIO y doctors.
- [x] GitHub Actions fijadas a commits SHA completos.
- [x] Release Android que espera el AAB y utiliza el build ID exacto.

## F2 — MercadoLibre read plane 🟡

### Implementado

- [x] Contratos de integración y configuración para MercadoLibre Chile.
- [x] Aislamiento explícito entre Plasticov y Maustian.
- [x] Guards para seller ID, organization y account scope.
- [x] OAuth authorization-code + PKCE, intercambio real y refresh token con lease.
- [x] Token secreto antiabuso para webhooks.
- [x] Idempotencia y trazabilidad de eventos.
- [x] Ingesta y persistencia de listings, órdenes, preguntas, reclamos y reputación.
- [x] `sourceHash` y `observedAt` en snapshots operacionales.
- [x] El Profit Engine lee el precio observado del snapshot MercadoLibre más reciente.
- [x] Product Ads v2 read plane para campañas, Ad Groups e ítems.
- [x] Advertiser discovery fail-closed y mapping explícito cuando existe ambigüedad.
- [x] Reconciliación de precio entre listing, Product Ads y Profit Engine.
- [x] Persistencia PostgreSQL y API autenticada para evidencia Product Ads.
- [x] Gasto Ads por listing solo cuando MercadoLibre entrega métricas directas del ítem.

### Pendiente live o de decisión comercial

- [ ] Configurar credenciales reales y redirect URI productiva.
- [ ] Conectar y validar OAuth de Plasticov.
- [ ] Conectar y validar OAuth de Maustian después de Plasticov.
- [ ] Verificar webhook real y deduplicación en producción.
- [ ] Ejecutar advertiser discovery real para Plasticov y fijar mapping si aparece más de uno.
- [ ] Comparar campañas, Ad Groups e ítems Product Ads contra MercadoLibre durante cinco días hábiles.
- [ ] Consolidar freshness, provenance y reconciliación económica con datos live.
- [ ] Definir una policy comercial versionada antes de convertir gasto Ads en costo unitario.
- [ ] Comparar todos los read models contra la interfaz real durante cinco días hábiles.

Los gates no delegables y su evidencia se rastrean en el issue #41.

## F3 — Agent OS gobernado 🟡

### Implementado

- [x] Jerarquía CEO humano → CEO Agent → directores → especialistas.
- [x] Catálogo de departamentos y contratos de rol.
- [x] Skills versionadas y hasheadas durante preflight.
- [x] Planner determinista con máximo de delegación.
- [x] Preflight con capabilities, política, evidencia, presupuesto y riesgo.
- [x] Work sessions idempotentes.
- [x] Heartbeats, deadline, iteraciones y gasto.
- [x] Scorecards y recomendación consultiva de autonomía.
- [x] Android para inspeccionar jerarquía, planes, sesiones y scorecards.

### Pendiente para operación inteligente real

- [ ] Conectar el provider LLM productivo seleccionado.
- [ ] Medir telemetría real de cache hit/miss y costo por sesión.
- [ ] Alimentar evidence packs desde read models live.
- [ ] Ejecutar work orders en shadow mode con resultados referenciables.
- [ ] Integrar memoria semántica consultiva sin convertirla en verdad operacional.
- [ ] Verificar outputs y outcomes económicos fuera del texto del agente.

## F4 — Content Studio real 🟡

### Implementado

- [x] Captura desde cámara y galería en Android.
- [x] Flujo de lanzamiento y assets.
- [x] Object storage S3-compatible.
- [x] Upload, URLs firmadas y checksums verificables.
- [x] Provider de desarrollo trazable que declara no haber generado contenido externo.
- [x] Product Identification con dominio, persistencia, runtime y API autenticada.
- [x] Revisión humana terminal y fingerprints por organización/cuenta.
- [x] Separación segura entre igualdad SHA-256 y similitud perceptual.
- [x] Android para identificar, inspeccionar evidencia y confirmar/rechazar.
- [x] Catalog Acquisition y Photo-to-Similar con revisión humana.

### Pendiente

- [ ] Conectar un proveedor visual real y allowlisted.
- [ ] Integrar un servicio perceptual real que produzca `phash-64`.
- [ ] Seleccionar y conectar proveedores reales de imagen y video.
- [ ] Incorporar moderación y políticas de marca.
- [ ] Crear brand kits separados para Plasticov y Maustian.
- [ ] Verificar que cada asset externo corresponda al producto y brief aprobados.

## F5 — Product Launch 🟡

### Implementado

- [x] Dominio, estados y flujo de propuesta/review/aprobación.
- [x] Content Studio y evidence bundles como base.
- [x] Gate económico y policy hash.
- [x] Foto → identificación verificable → decisión humana.
- [x] Unit economics determinista, margen, precio mínimo y propuestas de repricing.
- [x] Supplier Mirror, costo verificado y control de vigencia.
- [x] Catalog Acquisition y candidatos de proveedor persistidos.
- [x] Validación fail-closed de categoría y atributos MercadoLibre Chile.
- [x] Reader oficial de taxonomía con snapshots PostgreSQL, freshness y single-flight.
- [x] API autenticada y preflight Android sin escrituras.

### Pendiente

- [ ] Investigación de mercado y competencia con evidencia versionada.
- [ ] Generación real de assets y preview Android aprobado.
- [ ] Preparar draft de publicación sin ejecutar una mutación externa.
- [ ] Adapter de creación de publicación, separado de `question.answer` y todavía bloqueado.
- [ ] Verificación posterior de una publicación real.

## F6 — Autonomía limitada 🔒

La plataforma no habilitará autonomía por declaración del agente ni por cantidad de ejecuciones.

### Implementado sin activación live

- [x] Modos conceptuales `ask`, `inform` y `autonomous`.
- [x] Aprobación separada de ejecución y outcome.
- [x] Presupuesto y scope por cuenta.
- [x] Receipt chain y delivery log.
- [x] Estado `uncertain` sin reintento ciego.
- [x] Excepción de dominio acotada exclusivamente a `question.answer`.
- [x] Adapter HTTP real de `question.answer` con preflight, policy, seller guard y verificación.
- [x] Credencial OAuth cifrada y rotatoria conectada mediante lease para Plasticov.
- [x] Todas las demás escrituras MercadoLibre continúan bloqueadas.

### Gates obligatorios antes de activar `question.answer`

- [ ] Mantener la capability en modo `ask`.
- [ ] Configurar las credenciales reales y habilitar exclusivamente Plasticov después del gate de lectura.
- [ ] Historial live suficiente y sin violaciones de política.
- [ ] Receipt chain comparada con la respuesta remota durante dos semanas.
- [ ] Rollback o procedimiento de corrección probado para la capability concreta.
- [ ] Outcome económico atribuido y verificado.
- [ ] Límites diarios y de pérdida validados con dinero real.
- [ ] Promoción explícita mediante política independiente.

Hasta completar esos gates, las escrituras externas permanecen completamente deshabilitadas en runtime productivo.

## F7 — Expansión comercial ⬜

- [ ] Ecommerce propio.
- [ ] Gestión de proveedores y compras.
- [ ] Importaciones y forecast de inventario.
- [ ] Optimización y escritura de Product Ads detrás de una policy independiente.
- [ ] Redes sociales y distribución de contenido.
- [ ] Amazon, Alibaba y otros marketplaces.
- [ ] Nuevas organizaciones y cuentas sin perder aislamiento.

## Gates para declarar operación productiva

No se considera que EAUTO-AI esté operando comercialmente hasta completar todos los puntos siguientes:

- [ ] dominios, servidor y secretos productivos configurados;
- [ ] `doctor:production` verde con valores reales;
- [ ] OAuth Plasticov y Maustian validado;
- [ ] webhook real recibido, autenticado y deduplicado;
- [ ] Product Ads Plasticov reconciliado con evidencia real;
- [ ] primera sesión LLM shadow con evidencia y costo registrados;
- [ ] proveedor visual real y perceptual hash validados con imágenes conocidas;
- [ ] backup externo completo;
- [ ] restore drill exitoso en un entorno aislado;
- [ ] AAB firmado instalado en un dispositivo real;
- [ ] acciones aprobadas sin ejecución externa accidental;
- [ ] primera verificación post-acción contra MercadoLibre;
- [ ] primer outcome económico real reconciliado.

## Criterio de éxito

El roadmap no se mide por cantidad de agentes, endpoints o automatizaciones. El resultado buscado sigue siendo:

> **Beneficio neto sostenible y verificable, ajustado por riesgo, capital y costo de IA.**
