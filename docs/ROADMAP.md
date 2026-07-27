# Roadmap

> Estado actualizado después de la auditoría técnica de julio de 2026.

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
| F4 — Content Studio real     |   🟡   | Pasar de captura y simulación trazable a generación externa verificable       |
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
- [x] OAuth y webhook preparados en la arquitectura.
- [x] Token secreto antiabuso para webhooks.
- [x] Idempotencia y trazabilidad de eventos.

### Pendiente live

- [ ] Configurar credenciales reales y redirect URI productiva.
- [ ] Conectar y validar OAuth de Plasticov.
- [ ] Conectar y validar OAuth de Maustian.
- [ ] Verificar webhook real y deduplicación en producción.
- [ ] Completar ingesta de listings, órdenes, preguntas, reclamos, reputación y Ads.
- [ ] Consolidar freshness, provenance y reconciliación económica.
- [ ] Comparar read models contra la interfaz real de MercadoLibre.

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

### Pendiente

- [ ] Integrar visión e identificación de producto.
- [ ] Seleccionar y conectar proveedores reales de imagen y video.
- [ ] Incorporar moderación y políticas de marca.
- [ ] Crear brand kits separados para Plasticov y Maustian.
- [ ] Añadir comparación visual y control de duplicados.
- [ ] Verificar que cada asset externo corresponda al producto y brief aprobados.

## F5 — Product Launch 🟡

- [x] Dominio, estados y flujo de propuesta/review/aprobación.
- [x] Content Studio y evidence bundles como base.
- [x] Gate económico y policy hash.
- [ ] Foto → identificación verificable.
- [ ] Investigación de mercado y competencia.
- [ ] Unit economics, precio y margen mínimo.
- [ ] Validación de categoría y atributos MercadoLibre.
- [ ] Generación de assets y preview Android.
- [ ] Escritura preparada mediante adapter MercadoLibre.
- [ ] Verificación posterior de la publicación real.

## F6 — Autonomía limitada 🔒

La plataforma no habilitará autonomía por declaración del agente ni por cantidad de ejecuciones.

### Gates obligatorios

- [x] Modos conceptuales `ask`, `inform` y `autonomous`.
- [x] Aprobación separada de ejecución y outcome.
- [x] Presupuesto y scope por cuenta.
- [x] Receipt chain y delivery log.
- [x] Estado `uncertain` sin reintento ciego.
- [ ] Historial live suficiente y sin violaciones de política.
- [ ] Rollback probado para la capability concreta.
- [ ] Outcome económico atribuido y verificado.
- [ ] Límites diarios y de pérdida validados con dinero real.
- [ ] Promoción explícita mediante política independiente.

Hasta completar esos gates, las escrituras externas permanecen en modo `ask` o completamente deshabilitadas.

## F7 — Expansión comercial ⬜

- [ ] Ecommerce propio.
- [ ] Gestión de proveedores y compras.
- [ ] Importaciones y forecast de inventario.
- [ ] Publicidad y Product Ads.
- [ ] Redes sociales y distribución de contenido.
- [ ] Amazon, Alibaba y otros marketplaces.
- [ ] Nuevas organizaciones y cuentas sin perder aislamiento.

## Gates para declarar operación productiva

No se considera que EAUTO-AI esté operando comercialmente hasta completar todos los puntos siguientes:

- [ ] dominios, servidor y secretos productivos configurados;
- [ ] `doctor:production` verde con valores reales;
- [ ] OAuth Plasticov y Maustian validado;
- [ ] webhook real recibido, autenticado y deduplicado;
- [ ] primera sesión LLM shadow con evidencia y costo registrados;
- [ ] backup externo completo;
- [ ] restore drill exitoso en un entorno aislado;
- [ ] AAB firmado instalado en un dispositivo real;
- [ ] acciones aprobadas sin ejecución externa accidental;
- [ ] primera verificación post-acción contra MercadoLibre;
- [ ] primer outcome económico real reconciliado.

## Criterio de éxito

El roadmap no se mide por cantidad de agentes, endpoints o automatizaciones. El resultado buscado sigue siendo:

> **Beneficio neto sostenible y verificable, ajustado por riesgo, capital y costo de IA.**
