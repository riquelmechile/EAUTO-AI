# Juicio final de capacidades — EAUTO-AI vs MSL y kiiess

## Veredicto

EAUTO-AI ya integra el núcleo comercial y de gobernanza más importante de ambos proyectos, pero **no existe paridad total**.

La fuente canónica es `config/capability-parity.json`. El comando `npm run doctor:parity` comprueba que toda capacidad declarada como implementada o parcial tenga evidencia real dentro del repositorio.

Resumen actual:

| Estado | Cantidad | Significado |
| --- | ---: | --- |
| Implementada | 14 | Existe una capacidad equivalente y verificable en EAUTO-AI. |
| Parcial | 9 | Existe parte del comportamiento, pero falta una pieza funcional de MSL o kiiess. |
| Ausente | 7 | No existe implementación equivalente. |
| Reemplazada | 2 | La tecnología fue sustituida intencionalmente por otra arquitectura. |

## Capacidades implementadas

| Capacidad | Equivalencia EAUTO-AI |
| --- | --- |
| Aprobación y ejecución gobernada | Máquina de estados, policy hash, receipts, verificación y estado `uncertain`. |
| Plasticov y Maustian aisladas | Scope obligatorio por organización/cuenta y constraints PostgreSQL. |
| Agent OS | Contratos, skills, preflight, planner, sesiones, heartbeats, presupuesto y scorecards. |
| Procesamiento durable | Transactional outbox, leases, retries, dead-letter y worker recuperable. |
| Evidencia operacional | Evidence packs con freshness, provenance, autoridad y missing inputs. |
| Rentabilidad | Profit Engine, repricing, margin floor y auditoría periódica. |
| MercadoLibre read plane | OAuth, refresh, listings, órdenes, preguntas, reclamos, reputación y webhooks. |
| `question.answer` | Primera escritura dedicada, aprobada y verificada, restringida a Plasticov. |
| Product Ads v2 | Campañas, Ad Groups, ítems y reconciliación de precios/costos directos. |
| Supplier Mirror | Autoridad, freshness, costo verificado, stock-risk y auditoría. |
| Catalog Acquisition | Candidatos, evidencia, revisión humana y reconciliación. |
| Photo-to-Similar | Identificación, fingerprints, búsqueda visual y confirmación humana. |
| Control móvil | Android es el control plane canónico del CEO. |
| Producción | PostgreSQL, MinIO, backups, Docker, Caddy, GHCR, EAS y CI inmutable. |

## Capacidades parciales

| Capacidad de referencia | Qué existe | Qué falta |
| --- | --- | --- |
| Agent Message Bus de MSL | Outbox y work orders durables | Envelopes generales request/response entre agentes. |
| Evidence Response Router | Evidence reader y packs | Routing explícito hacia responders especialistas. |
| Memoria semántica | Memoria consultiva con provenance y outcome verificado | Embeddings, búsqueda semántica, Engram y aprendizaje tipo Cortex. |
| Account Brain | Inteligencia account-scoped y economía por cuenta | Grafo consolidado de activos, scoring estratégico y comparación histórica. |
| 16 daemons MSL | Worker 24/7, inteligencia, margin audit y stock audit | Catálogo completo de especialistas proactivos. |
| Creative Studio | Gateway genérico, assets privados y checksums | MiniMax concreto, brand kits, moderación y control de costo proveedor. |
| Supply workflows kiiess | Supplier Mirror, stock-risk y costo | `supplier.pause`, full scrape, autopause y opportunistic-buy completos. |
| Product lifecycle BI | Señales, rentabilidad y evidencia | Clasificador `active/seasonal/off-season/obsolete/uncertain`. |
| Economic CLI MSL | Servicios, API y smokes | CLI operacional de ingest/status/coverage/reconcile/missing. |

## Capacidades ausentes

1. Telegram como transporte CEO y aprobación “dale”.
2. Servidor MCP con herramientas comerciales.
3. Cortex como grafo neuronal con aprendizaje hebbiano y poda.
4. Routing local/cloud con LiteLLM, llama.cpp o vLLM.
5. Boundary concreto de ecommerce propio Medusa.
6. Adaptadores productivos para redes sociales.
7. Integraciones con Amazon, Alibaba u otros marketplaces.

## Decisiones de reemplazo

- **Consola web:** Android es el control plane canónico. Una web sigue siendo útil, pero no es requisito para operar desde el teléfono.
- **Redis como cola:** PostgreSQL transactional outbox y leases mantienen la fuente autoritativa única y reemplazan la cola Redis para el núcleo durable.

## Orden recomendado para alcanzar paridad funcional

### Ola 1 — Canales operativos

- Telegram con identidad, `/ceo`, inbox y aprobación/rechazo source-aware.
- MCP read-only primero; escrituras únicamente a través de `ActionService`.

### Ola 2 — Inteligencia y memoria

- Gateway OpenAI-compatible agnóstico al proveedor.
- Perfiles DeepSeek, LiteLLM y runtime local.
- Embeddings y retrieval gate sobre memoria consultiva.
- Evidence request/router y responders especializados.

### Ola 3 — Proactividad

- Scheduler declarativo de daemons.
- Morning report, unanswered questions, Product Ads monitor, product research y lifecycle BI.
- Account Brain consolidado por cuenta.

### Ola 4 — Expansión

- Adapter MiniMax o proveedor creativo elegido.
- Medusa/ecommerce propio.
- Redes sociales y marketplaces adicionales.

## Regla de aceptación

Una capacidad no pasa a `implemented` porque exista en el README. Debe tener:

1. contrato de dominio o aplicación;
2. persistencia o adapter cuando corresponda;
3. aislamiento por organización/cuenta;
4. tests adversariales;
5. doctor o smoke productivo;
6. política fail-closed para cualquier efecto externo.
