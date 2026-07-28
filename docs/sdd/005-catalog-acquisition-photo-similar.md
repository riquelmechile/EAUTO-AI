# SDD 005 — Catalog Acquisition and Photo-to-Similar

## Intent

Convert a verified source image into reviewable supplier-catalog acquisition candidates without allowing a visual model to invent product identity, stock, cost or supplier authority.

## Business outcome

An operator can upload one product photo, receive evidence-backed visual matches, search allowlisted supplier catalogs for concrete offers and review acquisition candidates that contain real SKU, stock and cost observations.

## Business modules

### Photo Similarity

Owns the consultative visual-search request and provider matches. It may suggest that an image resembles an external product, but it is never authoritative for product identity, supplier stock, cost, SKU or marketplace publication.

### Supplier Catalog Search

Owns concrete supplier offers returned by an allowlisted catalog adapter. Every offer includes supplier source, SKU, observed stock, observed unit cost, product URL and evidence.

### Acquisition Candidate Builder

Combines a sufficiently similar visual match with a fresh supplier-catalog offer in the same organization/account scope. The result remains `needs-review` and requires explicit human approval.

## Inputs

The workflow requires:

- organization and commerce-account scope;
- a source-image upload already verified by the existing upload boundary;
- an allowlisted visual-search provider;
- one or more allowlisted supplier sources;
- a minimum similarity threshold in basis points;
- a maximum evidence age;
- a versioned policy.

## Trust boundaries

- Only a verified source image may be submitted.
- The visual-search provider receives the verified object URI and checksum, never an unverified client URL.
- Visual matches are consultative evidence only.
- Similarity is an integer from 0 to 10,000 basis points.
- A match below policy threshold cannot create an acquisition candidate.
- A visual match cannot supply SKU, stock or cost.
- SKU, stock and cost must come from a successful supplier-catalog observation.
- Supplier catalog evidence must be fresh, scoped and produced by an allowlisted source.
- Cross-account, cross-organization and cross-source records are rejected.
- No candidate creates a Supplier Mirror link or assigns cost/availability authority.
- No candidate purchases inventory, creates a MercadoLibre listing or triggers Content Studio.
- Every candidate has `status=needs-review` and `requiresHumanApproval=true`.
- Code owns validation, thresholds, scope, IDs, hashes and lifecycle. Providers only return observations.

## Deterministic flow

1. Read the verified source-image upload in the requested scope.
2. Call the visual-search port with the verified URI and checksum.
3. Validate every provider match and discard matches below the configured threshold.
4. Search each configured supplier catalog using the normalized match title and optional external product URL.
5. Validate every supplier offer and reject stale, incomplete or out-of-scope evidence.
6. Pair each offer with the originating visual match.
7. Derive a stable candidate ID and content hash from scope, upload, provider match, supplier source, SKU, evidence hashes and policy version.
8. Persist candidates idempotently.
9. Return candidates for human review.

## Domain contracts

### PhotoSimilarityMatch

Contains:

- organization/account scope;
- source upload ID;
- provider and external match ID;
- normalized title and candidate URL;
- similarity basis points;
- observed timestamp and evidence.

### SupplierCatalogOffer

Contains:

- organization/account scope;
- supplier source and SKU;
- product name and URL;
- unit cost in minor units;
- available stock quantity;
- currency;
- observed timestamp and evidence.

### AcquisitionCandidate

Contains:

- stable ID and content hash;
- organization/account/source-upload scope;
- visual provider/match and similarity;
- supplier source, SKU, product name and URL;
- observed cost, stock and currency;
- visual and catalog evidence references;
- policy version;
- `needs-review` status;
- mandatory human approval.

## Failure behavior

The workflow fails closed when:

- the source image is missing or not verified;
- provider results violate scope or timestamps;
- similarity values are invalid;
- the supplier source is not allowlisted;
- stock or cost is absent, negative or unsafe;
- catalog evidence is stale;
- evidence timestamps do not match their observations;
- no provider/catalog adapter can produce authoritative observations.

A lack of candidates is a valid result. The service does not lower thresholds, infer missing values or ask an LLM to fabricate an offer.

## Acceptance criteria

- A verified image plus a high-confidence match and fresh catalog offer creates one review candidate.
- A low-confidence match creates no candidate and performs no catalog search.
- An unverified image blocks before provider invocation.
- Cross-account visual matches are rejected.
- Cross-source or non-allowlisted supplier offers are rejected.
- Stale catalog evidence creates no candidate.
- Missing/invalid stock or cost is rejected rather than estimated.
- Repeating identical evidence saves the same candidate ID/content hash.
- Different policy versions create distinct content hashes.
- Every result requires human approval and carries no remote mutation capability.

## Outside this slice

- Concrete supplier-specific HTTP scraping/selectors.
- CAPTCHA or anti-bot bypass.
- Browser automation against non-allowlisted websites.
- Automatic Supplier Mirror linking or authority transfer.
- Purchase orders, MercadoLibre publications or repricing.
- LLM-generated product identity.

## Next slice

PostgreSQL persistence, a hardened allowlisted HTTP catalog adapter, provider configuration and Android review UI.