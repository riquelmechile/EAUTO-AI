# SDD 007 — Durable Product Identification Review

## Intent

Make Product Identification and Photo-to-Similar durable without allowing an unconfirmed model output to become catalog authority.

## Scope

This slice owns:

- PostgreSQL persistence of identification evaluations;
- versioned 64-bit product fingerprints with explicit semantics;
- same-account duplicate search;
- terminal human confirmation or rejection;
- fingerprint indexing only after confirmation;
- idempotency and cross-scope protection;
- production smoke coverage.

Live vision providers, web search, category resolution and MercadoLibre listing creation remain outside this slice.

## Durable records

### Identification result

Stores the exact deterministic result, policy version, evaluated time and fingerprint used for duplicate search. The row ID is derived from a canonical SHA-256 hash of the result and fingerprint.

### Human review

A result can receive one terminal review:

- `confirmed`: the selected candidate is accepted and assigned a server-owned catalog product ID;
- `rejected`: the candidate is declined with a required reason and no product ID.

A second identical write is idempotent. A conflicting decision fails closed.

### Product fingerprint

Only a confirmed result creates a searchable product fingerprint. Ambiguous, no-match, duplicate-blocked, incomplete and rejected results never enter the product fingerprint index.

## Fingerprint contract

Every fingerprint contains:

- an explicit algorithm;
- a version;
- exactly 64 binary digits;
- an evidence reference to the verified source image.

The supported semantics are defined separately in SDD 008:

- `phash-64` is a perceptual signal and may use Hamming similarity;
- `sha256-prefix-64` is an exact-content development signal and only supports equality.

A fingerprint is an indexing signal, not identity evidence. Product identity remains the reviewed candidate plus evidence chain.

## Review invariants

- organization, account and identification ID must match;
- only `identified-pending-confirmation` can be reviewed;
- the candidate must equal the selected candidate;
- confirmation requires a product ID;
- rejection forbids product ID and requires a reason;
- review cannot predate evaluation;
- one terminal decision per identification;
- confirmed product fingerprints cannot be silently replaced.

## PostgreSQL concurrency

Review persistence locks the identification row with `FOR UPDATE`. Review and confirmed fingerprint are written in one transaction. A conflict rolls back both.

## Duplicate-search isolation

Search is limited by:

- organization;
- account;
- fingerprint algorithm;
- fingerprint version.

Results from Plasticov can never be used as Maustian duplicates and vice versa.

## Fail-closed behavior

- missing verified image stops before fingerprinting;
- fingerprint without the exact source evidence reference is rejected;
- invalid bit length or unsupported algorithm is rejected;
- missing identification cannot be reviewed;
- conflicting terminal review is rejected;
- fingerprint collision for the same catalog product is rejected;
- no review or fingerprint performs an external mutation.

## Acceptance criteria

- identical evaluations persist once;
- stored results preserve candidates, reasons, evidence and fingerprint;
- confirmation persists review and fingerprint atomically;
- rejection persists no fingerprint;
- repeated identical review is idempotent;
- conflicting review fails;
- duplicate search remains account-, algorithm- and version-scoped;
- algorithm-specific comparison semantics are verified in domain and PostgreSQL;
- migrations apply twice without drift;
- production validation requires the migrations and smoke;
- full immutable CI remains green.

## Next slice

Authenticated API routes, Android review UI, allowlisted live vision adapter, candidate evidence acquisition and MercadoLibre category/attribute resolution.
