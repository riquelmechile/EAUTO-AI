# SDD 015 — MercadoLibre Taxonomy Runtime and Authenticated Preflight API

## Context

SDD 012 defined the deterministic MercadoLibre taxonomy preflight. SDD 013 added the official read-only HTTP adapter and SDD 014 added append-only PostgreSQL snapshots with freshness-controlled refresh. The application still needs a production composition and an authenticated API surface before Android can request category validation.

## Decision

Compose a dedicated taxonomy runtime when MercadoLibre routes are registered:

- official `https://api.mercadolibre.com` taxonomy reader;
- bounded response and timeout controls owned by the server;
- PostgreSQL snapshot repository;
- freshness reader with single-flight refresh;
- deterministic taxonomy preflight service;
- immutable `MLC` policy and policy version owned by the server.

Expose:

`POST /v1/integrations/mercadolibre/:accountId/taxonomy/preflight`

The request contains only a Chile category ID and submitted attributes. It cannot provide freshness thresholds, policy versions, evidence timestamps, hashes or marketplace authority.

## Invariants

1. The route requires an authenticated actor with `integrations.read` access to the scoped account.
2. The actor organization, not request data, determines tenant scope.
3. Category IDs must match `MLC[0-9]+`.
4. The request schema is strict; unknown top-level fields are rejected.
5. Freshness age, policy version, official API origin, timeout and response limit are server-owned constants.
6. Production composition requires PostgreSQL; without it the taxonomy endpoint fails closed.
7. Official category and attribute evidence is refreshed through the cache from SDD 014.
8. Stale evidence is never returned after an official refresh failure.
9. The endpoint returns deterministic `ready`, `blocked` or `incomplete` results plus `writesPerformed: false`.
10. The endpoint performs no `/items` validation, creation or modification.
11. OAuth access tokens are not required for public taxonomy reads and are never sent to category endpoints.
12. Android, an LLM and remote providers cannot override or declare the policy result.

## Server-owned policy

- site: `MLC`;
- evidence maximum age: 24 hours;
- policy version: `mercadolibre-taxonomy-v1`;
- HTTP timeout: 15 seconds;
- maximum response size: 1 MiB;
- official base URL: `https://api.mercadolibre.com`.

Changing these values requires a reviewed code change and a new policy version when behavior changes.

## Out of scope

- Android category and missing-attribute UI.
- `POST /items/validate`.
- publication drafts, approvals and writes.
- market and competitor research.

## Verification

Tests verify authenticated account scoping, server-owned policy injection, strict request rejection, explicit no-write responses and fail-closed behavior when PostgreSQL taxonomy runtime is unavailable.
