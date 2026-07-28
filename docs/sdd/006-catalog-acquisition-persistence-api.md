# SDD 006 — Catalog Acquisition Persistence and Review API

## Intent

Persist Photo-to-Similar acquisition candidates durably, expose them through authenticated account-scoped API endpoints and support a single human review transition without granting purchase, listing, stock or supplier-authority capabilities.

## Business outcome

An operator can run a configured catalog discovery, view the resulting candidates and accept or reject each candidate from the application. Accepted candidates remain evidence records for a later planning slice; they do not execute a commercial action.

## Lifecycle

A candidate starts as `needs-review` and may transition exactly once to:

- `accepted`
- `rejected`

No transition back to `needs-review` exists. Accepted and rejected candidates are immutable.

Each review records:

- reviewer identity;
- review timestamp;
- optional review note;
- resulting status.

## Permissions

- `catalog.read`: list and inspect acquisition candidates.
- `catalog.acquire`: invoke configured Photo-to-Similar discovery.
- `catalog.review`: accept or reject a candidate.

Role defaults:

- owner/admin: all catalog permissions;
- operator: read, acquire and review;
- reviewer: read and review;
- viewer: read only;
- agent: read and acquire, never review.

## Persistence model

PostgreSQL owns a `catalog_acquisition_candidates` table with:

- stable candidate ID and SHA-256 content hash;
- organization/account/upload scope;
- visual provider and match identity;
- supplier source, SKU, cost, stock and currency;
- exactly two evidence references;
- policy version;
- lifecycle status and review metadata;
- immutable JSON payload for API reconstruction.

A database trigger enforces:

- inserts are always `needs-review`;
- inserted review metadata is null;
- `requiresHumanApproval` remains true;
- immutable economic, supplier, evidence, scope and policy fields cannot change;
- the only update is `needs-review` to `accepted` or `rejected`;
- review identity and time are mandatory on transition;
- payload lifecycle fields match the scalar columns.

## Idempotency

Discovery saves by stable content hash. Repeating identical evidence returns the existing candidate. Reusing an ID or hash with different content fails closed.

Review uses compare-and-set semantics against `status=needs-review`. Concurrent or repeated reviews fail with a lifecycle conflict.

## API

### POST `/v1/catalog-acquisition/discover`

Requires `catalog.acquire` for the account. The API supplies the server-owned policy; clients cannot lower similarity or evidence-age thresholds.

When providers are disabled or incompletely configured, the endpoint returns `503 catalog-acquisition-unavailable`.

### GET `/v1/catalog-acquisition/candidates`

Requires `catalog.read`. Supports account, status and bounded limit filters. Cross-account candidates remain invisible.

### POST `/v1/catalog-acquisition/candidates/:id/review`

Requires `catalog.review` and an account-scoped body containing `decision=accepted|rejected` plus an optional note.

The endpoint never creates an action, listing, order, Supplier Mirror link or authority transfer.

## External provider boundary

The runtime may use two generic HTTPS gateways:

- a visual similarity endpoint;
- an allowlisted map of supplier source IDs to catalog endpoints.

The server owns every endpoint, source ID, provider name, policy threshold and timeout. Client-supplied URLs are never fetched.

Provider responses are bounded, JSON-only and normalized into domain observations. Redirects are rejected, response sizes are limited and timeouts are mandatory.

## Failure behavior

- invalid provider payload: fail closed;
- provider timeout or non-2xx response: fail closed;
- unconfigured source: unavailable/conflict;
- invalid or stale evidence: no candidate;
- cross-scope repository lookup: not found;
- repeated review: conflict;
- database payload/column divergence: rejected by PostgreSQL.

## Acceptance criteria

- Identical candidates persist idempotently in memory and PostgreSQL.
- Cross-account reads return no candidate.
- Candidate listing is bounded and sorted newest first.
- Only one review transition succeeds.
- Reviewer, timestamp and note persist durably.
- A viewer can read but cannot discover or review.
- An agent can discover but cannot review.
- API policy comes from configuration, not request data.
- Disabled providers return a controlled 503.
- PostgreSQL smoke verifies insert, idempotency, listing, scope isolation and review CAS.
- Full CI, production runtime, Docker and object-storage gates remain green.

## Outside this slice

- Automatic Supplier Mirror linking.
- Purchase orders.
- MercadoLibre publication.
- Accepted-candidate profitability simulation.
- Android-specific review screens.
- Supplier-specific scraping selectors or anti-bot bypass.
