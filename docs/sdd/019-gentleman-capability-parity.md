# SDD 019 — Gentleman capability parity

## Estado

Implementación activa.

## Objetivo

Completar las capacidades pendientes de MSL y kiiess dentro de EAUTO-AI sin romper sus invariantes de seguridad ni copiar complejidad accidental:

1. bus general entre agentes;
2. Evidence Response Router;
3. memoria semántica;
4. Account Brain;
5. dieciséis daemons especialistas;
6. Creative Studio concreto;
7. supply workflows completos;
8. lifecycle BI;
9. CLI económica operacional.

## Principios derivados del libro

### Dominio autónomo

`packages/domain` contiene entidades, value objects, estados y reglas deterministas. No importa Fastify, PostgreSQL, MiniMax, LLMs ni SDKs.

### Puertos y adaptadores

Los casos de uso dependen de puertos. PostgreSQL, HTTP, MiniMax, CLI y workers son adaptadores reemplazables.

### Monolito modular y Scope Rule

Cada capability nace en su feature. Solo se promueven contratos realmente compartidos. La estructura debe gritar el negocio, no la tecnología.

### Planner separado de ejecución

Los daemons detectan señales, congelan evidencia y crean work orders. El LLM interpreta y propone; el dominio valida. Ningún output de modelo autoriza una mutación.

### Comunicación durable y effectively-once

Mensajes, requests de evidencia y ejecuciones usan idempotencia, leases, retry con backoff y dead-letter. Duplicar entrega no puede duplicar efectos.

### Memoria fuera del contexto

La memoria vive en PostgreSQL, con búsqueda full-text, topic keys, revisiones, reconciliación (`supersedes`, `conflicts-with`, `compatible`) y provenance. No se cargan historiales completos ni se usa memoria como verdad operacional.

### Confianza verificable

Opinión y evidencia son distintas. Cada transición durable conserva hashes, referencias y estado. La evidencia actual se re-deriva al usarla; no se confía en narración de agentes.

### TDD y pequeñas liberaciones

Cada capability tendrá contrato, implementación mínima útil, tests adversariales, migración y doctor/smoke. El PR puede integrar slices completas, pero cada módulo debe poder probarse aislado.

## Arquitectura

```text
Domain
  AgentMessage, EvidenceRequest/Response, SemanticMemory,
  AccountBrain, DaemonDefinition/Run, SupplyWorkflow,
  ProductLifecycle, EconomicOperation

Application
  AgentMessageBusService
  EvidenceResponseRouter
  SemanticMemoryService
  AccountBrainService
  SpecialistDaemonScheduler
  SupplyWorkflowService
  ProductLifecycleService
  EconomicOperationsService

Infrastructure
  PostgreSQL repositories + full-text index
  MiniMax image/video adapter
  Existing verified read-model evidence adapter

Drivers
  Fastify routes
  backend worker
  economic CLI
```

## Invariantes

- Plasticov y Maustian siempre scoped por `organizationId + accountId`.
- El message payload no concede autoridad.
- Evidence responses solo contienen documentos con provenance.
- Semantic memory es consultiva y puede quedar `needs-review`, `conflicted` o `superseded`.
- Account Brain no completa datos faltantes; declara `missingInputs`.
- Los dieciséis daemons solo generan work orders/propuestas en `ask`.
- Creative Studio guarda assets en storage privado antes de devolverlos.
- Supply workflows no compran, pausan ni modifican stock directamente; generan acciones gobernadas o dry-runs.
- Lifecycle BI devuelve `uncertain` cuando no hay evidencia suficiente.
- CLI económica es read/reconcile por defecto y nunca habilita writes MercadoLibre.

## Dieciséis daemons canónicos

1. economic-ingestion
2. unit-economics
3. pricing
4. ads-profitability
5. analytics
6. catalog
7. product-research
8. listing-retread
9. supplier-manager
10. inventory-forecast
11. acquisition-imports
12. sales-service
13. claims-reputation
14. shipping-logistics
15. creative-studio
16. product-ads

## Criterios de aceptación

- Mensajes: publish/lease/resolve/fail/dead con idempotencia y tenant isolation.
- Evidence Router: selección determinista de responder, request/response correlacionados y evidencia verificable.
- Memory: structured observations, full-text ranking, topic history, collision reconciliation y retrieval gate.
- Account Brain: snapshot determinista y completo/incompleto según evidencia actual.
- Daemons: exactamente dieciséis definiciones activas, state durable, cooldown y work orders gated.
- Creative Studio: adapter MiniMax oficial para imagen y video, timeout, byte limits, fixed host y private persistence.
- Supply: pause, full-scrape, stock-sync, autopause y opportunistic-buy como workflows auditables y no ejecutables por defecto.
- Lifecycle: clasificación `active`, `seasonal`, `off-season`, `obsolete-candidate`, `insufficient-data`, `uncertain`.
- Economic CLI: `ingest`, `status`, `coverage`, `reconcile`, `missing`, `inspect-evidence`.
- `npm run check`, doctors, PostgreSQL smoke, Docker y CI verdes.
