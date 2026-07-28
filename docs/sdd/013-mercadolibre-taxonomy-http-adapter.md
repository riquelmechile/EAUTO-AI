# SDD 013 — MercadoLibre Taxonomy HTTP Adapter

## Context

The taxonomy preflight requires current category and attribute contracts. Raw MercadoLibre responses cannot become domain authority because remote payloads may be malformed, unexpectedly large or contain fields that must not control organization/account scope.

## Decision

Add a dedicated read-only HTTP adapter for the official MercadoLibre category endpoints.

## Endpoints

- `GET /categories/{categoryId}`
- `GET /categories/{categoryId}/attributes`

## Invariants

1. Category IDs must match `MLC[0-9]+`.
2. Redirects are rejected.
3. Requests have a bounded timeout and response byte limit.
4. HTTP failures and invalid JSON fail closed.
5. The requested category ID must match the response ID.
6. Category tree, listing permission and attribute contracts are normalized locally.
7. Required/fixed flags are derived only from documented attribute tags.
8. `observedAt` and `sourceHash` are created locally.
9. Remote organization/account/timestamp/hash fields are ignored.
10. The adapter performs no marketplace writes.

## Out of scope

- Snapshot persistence and cache refresh.
- Category prediction.
- Product listing validation or creation.
- Android and API routes.

## Verification

Tests cover request path, normalization, local evidence ownership, cross-category payload rejection, malformed values, byte cap, redirects, timeout and HTTP failures.
