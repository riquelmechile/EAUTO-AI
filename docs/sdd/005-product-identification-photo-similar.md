# SDD 005 — Product Identification and Photo-to-Similar

## Intent

Convert a verified source image into a governed product-identification decision without allowing a vision provider or LLM to declare product identity, duplicate safety or launch readiness by itself.

## Business outcome

A user uploads one product photo from Android. EAUTO-AI verifies the private object, asks a vision adapter for ranked candidates, checks the account catalog for visual duplicates and returns a deterministic result that can be reviewed before market research or listing preparation begins.

## Scope of this slice

This slice owns:

- the identification decision model;
- confidence and ambiguity policy;
- visual duplicate blocking;
- verified source-image scope;
- evidence freshness;
- provider contracts;
- deterministic development fixtures;
- human-confirmation requirement.

It does not yet own live computer vision, web search, MercadoLibre category resolution, pricing, generated assets or remote listing writes.

## Architecture

```text
Verified source image
        ↓
ProductIdentificationService
        ↓
Vision candidate port ───────┐
Visual duplicate port ───────┤
                             ↓
              deterministic domain policy
                             ↓
                identification result
                             ↓
                    human confirmation
```

The provider proposes observations. Code owns status, thresholds, scope, freshness and authority.

## Result states

### `identified-pending-confirmation`

The best candidate satisfies minimum confidence and has the required lead over the second candidate. It remains unconfirmed and requires explicit human confirmation.

### `ambiguous`

At least two candidates are too close under policy. No candidate is selected.

### `no-match`

The provider returned no candidate or the best candidate is below minimum confidence.

### `duplicate-blocked`

A product already in the same account reaches the visual-similarity threshold. Launch progression is blocked until a human resolves whether it is the same product, a variant or a false positive.

### `incomplete`

Evidence is stale, future-dated or a candidate does not cite the verified source image.

## Evidence contract

The source image must:

- come from a verified upload;
- match organization, account and upload ID;
- use a private `s3://` object URI;
- carry checksum-derived identity;
- include a verification timestamp;
- remain within the configured evidence age.

Every proposed candidate must cite the exact source-image evidence ID. A candidate without that reference is incomplete rather than trusted.

## Confidence policy

All confidence and similarity values use integer basis points from 0 to 10,000.

The policy owns:

- minimum candidate confidence;
- minimum lead over the second candidate;
- duplicate similarity threshold;
- maximum source-evidence age;
- policy version.

Candidates are ordered by confidence descending and stable ID ascending. Duplicate matches are ordered by similarity descending and product ID ascending. This makes identical inputs deterministic.

## Duplicate authority

Duplicate results must belong to the requested account. Cross-account results are rejected before domain evaluation.

A duplicate above threshold wins over candidate confidence: even a highly confident identity cannot progress while the source image appears to duplicate an existing product.

## Trust boundaries

- A model confidence score is not confirmation.
- A model cannot lower or bypass policy thresholds.
- A provider cannot return a duplicate from another account.
- Missing or stale evidence fails closed.
- Unknown images produce `no-match`; deterministic development adapters never invent candidates.
- No result creates a MercadoLibre publication or external mutation.
- Only `identified-pending-confirmation` exposes a selected candidate, and it still requires a human.

## KV-cache compatibility

Stable policy, candidate schema and output contract form the stable prefix. The verified image reference and candidate observations are volatile context. Future LLM explanations may use this layout, but the LLM will not own the decision state.

## Acceptance criteria

- A clear, sufficiently confident candidate becomes pending human confirmation.
- Close top candidates become ambiguous.
- Low confidence and empty candidate sets become no-match.
- A same-account duplicate above threshold blocks progression.
- Stale or future-dated evidence becomes incomplete.
- Every candidate must cite the verified source image.
- A missing or cross-scope upload stops before providers run.
- A cross-account duplicate result is rejected and not persisted.
- Candidate and evidence ordering is deterministic.
- Unknown deterministic fixtures return no candidates instead of guessed identity.
- No state performs a remote write.

## Next slice

Durable PostgreSQL identification runs, visual fingerprints and human confirmation lifecycle, followed by a live allowlisted vision adapter and category/attribute research.
