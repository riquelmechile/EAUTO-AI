# SDD 016 — Android MercadoLibre Taxonomy Preflight

## Context

The authenticated taxonomy preflight from SDD 015 is the only authority that may declare a MercadoLibre Chile category and submitted attributes ready, blocked or incomplete. Android now needs a usable operator surface without reproducing marketplace rules locally or exposing a publication action.

## Decision

Add a taxonomy preflight section to each MercadoLibre account card in the Expo Android application.

The operator can:

- enter one `MLC` category ID;
- add, edit and remove submitted attribute rows;
- provide an attribute ID and either a value ID, value name or both;
- request the authenticated server preflight;
- see deterministic status, reasons, missing required attribute IDs and invalid attribute IDs;
- receive automatically created empty rows for required attributes reported as missing;
- re-run preflight after filling those values.

## Invariants

1. Android never evaluates MercadoLibre taxonomy policy.
2. Android never declares a category valid from local rules.
3. The only local category check is input hygiene: trim, uppercase and require `MLC[0-9]+` before sending.
4. Tenant and account scope remain derived from the authenticated session and selected account route.
5. The client cannot send policy version, freshness limits, evidence timestamps or source hashes.
6. Every successful response must explicitly contain `writesPerformed: false`; any other value fails closed.
7. Missing attributes are displayed and may be added as empty form rows, but remain missing until the server returns a different result.
8. Unknown, duplicate and invalid attributes remain server decisions and are rendered without reinterpretation.
9. The UI exposes no publish, validate-item, price, stock or advertising mutation.
10. Changing category clears the previous result so evidence for one category is never displayed as current for another.

## Status presentation

- `ready`: official taxonomy preflight passed; this does not create or publish an item.
- `blocked`: one or more deterministic taxonomy rules block progression.
- `incomplete`: current official evidence is insufficient or stale.

The screen always shows that the operation is server-validated and performs no publication.

## Out of scope

- category search or recommendation;
- fetching human-readable attribute definitions beyond result IDs;
- `POST /items/validate`;
- publication draft generation;
- human approval and MercadoLibre writes.

## Verification

Pure helper tests cover category normalization, payload construction, missing-row merging and reason labels. Mobile TypeScript verifies the API contract and React Native integration. The monorepo CI continues to run all production gates.
