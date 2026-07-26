# Target Architecture

## Capas

```text
Interfaces: Android / Web / Telegram / MCP
    ↓
Application: objectives, work orders, orchestration, actions, content
    ↓
Domain: policies, state machines, money, evidence, outcomes
    ↑
Adapters: MercadoLibre, LLM, image/video, Postgres, Redis, storage
```

La regla de dependencias siempre apunta hacia el dominio.

## Plano de control

- Android CEO App.
- API Fastify.
- Authentication/RBAC.
- CEO inbox.
- Approval service.
- Audit/receipt explorer.

## Plano operacional

- Scheduler con leases.
- Workers desacoplados.
- Transactional outbox.
- Dead-letter queue.
- Retry con backoff y jitter.
- Webhooks y polling bounded.

## Plano de inteligencia

- CEO Agent.
- Directores.
- Especialistas.
- Prompt compiler cache-friendly.
- Skill registry versionado.
- Wake policy por expected utility.
- Model gateway local/cloud.

## Persistencia

- Postgres: verdad autoritativa.
- Redis: colas, locks, rate limits y caché efímera.
- Object storage: imágenes, videos, evidence bundles y artifacts.
- Engram: memoria semántica advisory-only.
- Cortex: relaciones y aprendizaje desde outcomes elegibles.
- Android SQLite/Room: caché offline y drafts, nunca secretos cloud.

## Organización

```text
CEO humano
└── CEO Agent
    ├── Finanzas y Rentabilidad
    ├── Portafolio
    ├── Inventario, Compras e Importaciones
    ├── Operaciones y Reputación
    ├── Crecimiento y Contenido
    └── Expansión
```

Máximo dos niveles reales de delegación.
