# SDD 007 — Durable Product Identification Review

## Intent

Make Product Identification and Photo-to-Similar durable without allowing an unconfirmed model output to become catalog authority.

## Scope

This slice owns:

- PostgreSQL persistence of identification evaluations;
- deterministic 64-bit visual fingerprints;
- same-account visual similarity search;
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

### Product visual fingerprint

Only a confirmed result creates a searchable product fingerprint. Ambiguous, no-match, duplicate-blocked, incomplete and rejected results never enter the product similarity index.

## Fingerprint contract

The first supported algorithm is `phash-64`:

- exactly 64 binary digits;
- versioned algorithm implementation;
- evidence reference to the verified source image;
- similarity expressed in integer basis points;
- identical fingerprints score 10,000;
- opposite fingerprints score zero.

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

## Similarity isolation

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
- identical fingerprint returns 10,000 similarity basis points;
- duplicate search remains account-scoped;
- migrations apply twice without drift;
- production validation requires both migrations and the PostgreSQL smoke;
- full immutable CI remains green.

## Next slice

Allowlisted live vision adapter, candidate evidence acquisition, MercadoLibre category/attribute resolution and Android review UI.
