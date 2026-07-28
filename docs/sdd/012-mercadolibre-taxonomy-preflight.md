# SDD 012 — MercadoLibre Taxonomy Preflight

## Context

Product Identification can produce a human-confirmed product, but a launch still lacks a deterministic gate proving that the selected MercadoLibre Chile category is a leaf, belongs to site `MLC`, permits listings and has all required attributes completed with values compatible with the category contract.

## Decision

Introduce a pure taxonomy preflight before draft generation or any marketplace write.

The external adapter may read category detail and category attributes. Application code owns scope, freshness, policy version, normalization and the final decision.

## States

- `ready`: category and attributes satisfy the server policy.
- `blocked`: evidence is current but the category or submitted values violate an explicit rule.
- `incomplete`: category or attribute evidence is missing or stale.

## Invariants

1. Only site `MLC` is accepted in this vertical.
2. The category must be a leaf and have listing status enabled.
3. Category detail and attribute evidence must cite retrieval timestamps and source hashes.
4. Evidence older than the configured maximum age is rejected.
5. Every attribute tagged `required` must be present.
6. A list attribute only accepts one of its allowlisted values.
7. Fixed attributes cannot be overridden with a value outside their allowlist.
8. Unknown submitted attributes are blocked rather than silently dropped.
9. The client cannot provide policy version, timestamps or provider URLs.
10. No result creates or updates a MercadoLibre item.

## Ports

- `ForReadingMercadoLibreTaxonomy`: reads category detail and attributes.
- `MercadoLibreTaxonomyPreflightService`: verifies evidence and evaluates the pure domain decision.

## Out of scope

- Category prediction or LLM-owned category selection.
- Conditional attributes unavailable for Chile.
- Market/competitor research.
- Draft creation and `/items` writes.
- Android UI.

## Verification

Tests cover ready, non-leaf, disabled listing, missing required attribute, invalid list value, unknown attribute, wrong site and stale evidence.
