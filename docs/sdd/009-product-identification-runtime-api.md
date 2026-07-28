# SDD 009 — Product Identification Runtime and API

## Intent

Expose durable Product Identification through the authenticated application runtime without allowing clients or model providers to own identity, policy, reviewer metadata or lifecycle timestamps.

## Scope

This slice owns:

- application-owned identification IDs and content hashes;
- in-memory and PostgreSQL runtime repositories;
- adaptation of allowlisted photo-similarity results into identification candidates;
- authenticated identify, read and review routes;
- server-owned policy, reviewer identity, review ID and timestamps;
- production runtime and API validation.

Android UI, a native perceptual-hash provider, web-search evidence, MercadoLibre category resolution and listing creation remain outside this slice.

## Authority boundaries

### Application code owns

- identification ID;
- canonical content hash;
- lifecycle status;
- policy thresholds and version;
- evidence freshness evaluation;
- duplicate gates;
- reviewer identity from authentication;
- review ID and decision timestamp;
- persistence and compare-and-set semantics.

### Visual provider owns only observations

The allowlisted visual provider may propose:

- an external match ID;
- title;
- candidate URL;
- confidence/similarity basis points;
- observed evidence and content hash.

It cannot assign a catalog product ID, confirm a candidate, change policy or perform a marketplace mutation.

## Runtime modes

### `catalog-visual-external`

Enabled when the existing Catalog Acquisition visual provider is configured. Its observations are adapted into governed Product Identification candidates.

### `deterministic-development`

Available only outside production. It computes an exact-content `sha256-prefix-64` fingerprint and returns no invented candidates unless explicit deterministic fixtures are supplied.

### `disabled`

Production fails closed when no allowlisted visual provider exists. Stored identifications remain readable and reviewable, but new identification requests return a controlled unavailable response.

## Policy

The client never submits thresholds. Runtime derives a frozen, versioned Product Identification policy from server configuration:

- minimum candidate confidence;
- minimum lead over the second candidate;
- duplicate threshold;
- maximum evidence age;
- policy version.

Exact-content fingerprints only block exact content. A real `phash-64` provider is still required for perceptual duplicate detection.

## API contract

### `POST /v1/product-identification/identify`

Input:

- account ID;
- verified source image upload ID.

Requires `catalog.acquire`. Returns the canonical stored identification, runtime mode and policy version. The client cannot provide policy, timestamps, evidence URLs or provider routes.

### `GET /v1/product-identification/:id`

Requires `catalog.read` and explicit account scope. Cross-account reads return no data.

### `POST /v1/product-identification/:id/review`

Requires `catalog.review`.

The client may provide only:

- account ID;
- candidate ID;
- `confirmed` or `rejected`;
- product ID for confirmation;
- rejection reason when rejected.

The server assigns reviewer identity, review ID and decision time. A second contradictory terminal decision returns a conflict.

## Persistence invariants

- artifact ID equals `product_identification_<canonical content hash>`;
- application and PostgreSQL use the same canonical hash material;
- identical artifacts persist idempotently;
- organization/account scope is mandatory for every read and review;
- confirmation indexes one fingerprint atomically;
- rejection indexes none;
- in-memory development behavior mirrors PostgreSQL lifecycle semantics;
- provider candidates must cite the exact verified source evidence;
- no endpoint mutates MercadoLibre or a supplier.

## Permissions

Existing catalog permissions are reused:

- viewer: read;
- reviewer: read and review;
- operator/owner: identify, read and review;
- agent: identify and read, never review.

## Fail-closed behavior

- unverified or foreign-scope images stop before provider calls;
- disabled production runtime returns 503 for new identification;
- missing records return 404;
- terminal conflicts return 409;
- invalid candidate/review state returns 400;
- client-supplied reviewer metadata or timestamps are not accepted;
- foreign provider scope is rejected before persistence.

## Acceptance criteria

- identification returns a stable application-owned ID and content hash;
- PostgreSQL preserves the same ID/hash contract as in-memory development;
- allowlisted photo matches map to cited candidates and reject foreign scope;
- operator can identify; viewer can read but cannot identify or review;
- reviewer identity comes from the authenticated session;
- confirmed review becomes searchable by fingerprint;
- contradictory review fails;
- production runtime reports `catalog-visual-external` with server-owned policy;
- complete immutable CI, PostgreSQL runtime, Docker and object-storage gates remain green.

## Next slice

Android identification/review screens and a dedicated allowlisted visual service that returns real candidate evidence plus an actual versioned perceptual fingerprint.
