# SDD 014 — MercadoLibre Taxonomy Snapshots and Freshness Cache

## Context

The official taxonomy reader introduced in SDD 013 is fail-closed and read-only, but every preflight call would otherwise depend directly on MercadoLibre availability. Taxonomy evidence must remain versioned, tenant-scoped and fresh without allowing Android, an LLM or a remote payload to control cache authority.

## Decision

Persist normalized category and attribute contracts as append-only PostgreSQL snapshots and place a server-owned freshness reader in front of the official HTTP source.

## Invariants

1. Every snapshot is scoped by `organizationId`, `accountId`, `categoryId` and snapshot kind.
2. Only Chile category IDs matching `MLC[0-9]+` are accepted.
3. Category and attribute snapshots are append-only and versioned by their locally owned source hash.
4. Identical evidence is idempotent; the same source hash cannot identify a different payload.
5. Reads return only the newest scoped snapshot for the requested kind.
6. Freshness is evaluated from the locally owned `observedAt` field using a server-owned maximum age.
7. Invalid, future-dated and expired evidence is stale.
8. Missing or stale evidence triggers one controlled refresh per scoped key in each runtime instance.
9. A failed refresh never falls back to stale evidence.
10. Source responses must remain bound to the requested category before persistence.
11. PostgreSQL payloads are validated again before becoming application evidence.
12. This slice performs no `/items` calls and exposes no Android or API route.

## Storage

A single append-only table stores category and attribute snapshots with:

- tenant and account scope;
- category ID and snapshot kind;
- official observation time;
- locally generated source hash;
- normalized JSON payload;
- deterministic uniqueness for idempotency;
- an index for newest-snapshot reads.

## Refresh behavior

- Fresh snapshot: return it without a network request.
- Missing or stale snapshot: read the official source, validate scope, persist and return it.
- Official source returns null: return null.
- Official source fails or returns mismatched evidence: fail closed.
- Concurrent requests for the same scoped kind share one in-flight refresh.

## Out of scope

- Runtime wiring and environment configuration.
- Authenticated HTTP endpoint.
- Android category selection.
- Listing validation and creation.

## Verification

Tests cover freshness boundaries, future evidence, controlled refresh, stale fail-closed behavior and category binding. A PostgreSQL smoke verifies append-only versions, idempotency, newest reads and tenant isolation.
