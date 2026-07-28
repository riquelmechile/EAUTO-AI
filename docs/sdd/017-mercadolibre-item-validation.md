# SDD 017 — Official MercadoLibre Item Validation

## Context

The system can now obtain and cache official MercadoLibre Chile taxonomy evidence, expose a deterministic taxonomy preflight and collect category attributes from Android. Before any future publication draft may progress toward approval, the exact item payload must be checked with MercadoLibre's official `POST /items/validate` endpoint.

## Decision

Add a narrowly scoped validation-only adapter and an authenticated account route:

`POST /v1/integrations/mercadolibre/:accountId/items/validate`

The route first runs the deterministic taxonomy preflight with the same category and attributes. Only a `ready` taxonomy result may reach MercadoLibre's official item validator.

## Server-owned fields

The client cannot supply or override:

- currency: `CLP`;
- buying mode: `buy_it_now`;
- shipping mode: `me2`;
- site: `MLC`;
- OAuth access token;
- seller identity;
- taxonomy policy or freshness;
- validation endpoint or HTTP method.

The client supplies bounded draft content only: title, category, price in CLP minor units, quantity, listing type, attributes, sale terms, picture sources and two shipping booleans.

## Invariants

1. The adapter can call only `POST /items/validate` on the configured MercadoLibre API origin.
2. Redirects are blocked, responses are byte-bounded and requests have a server-owned timeout.
3. HTTP `204` is normalized as `valid`.
4. HTTP `400` is normalized as `invalid` with structured official causes.
5. Any other status, malformed response, timeout or oversized response fails closed.
6. A `401` marks the account as requiring reauthorization.
7. Token decryption and refresh remain inside `MercadoLibreService`; routes and Android never receive raw credentials.
8. The connected seller ID is attached locally to the validation evidence and is never accepted from the request.
9. The validation evidence hash binds the exact normalized request and official response status/body.
10. Taxonomy `blocked` or `incomplete` results prevent the official item-validation call.
11. The response always declares `writesPerformed: false`.
12. No code in this slice calls `POST /items`, `PUT /items/{id}` or any listing mutation.
13. The deprecated top-level `condition` field is not accepted; item condition must be represented as an attribute.
14. A successful validation is not an approval and does not create a publication draft.

## Result

The route returns:

- `taxonomy-blocked` or `taxonomy-incomplete`, with no remote item validation;
- `valid`, with zero official causes;
- `invalid`, with normalized official causes;
- local `observedAt`, `sourceHash`, connected `sellerId` and `writesPerformed: false`.

## Out of scope

- persistence of item-validation receipts;
- market and competitor research;
- publication draft generation;
- approval records;
- item creation or modification;
- variations and category-specific publication builders.

## Verification

Tests cover exact URL and HTTP method, 204 success, 400 cause normalization, redirect blocking, timeout, response limits, reauthorization, taxonomy gating, strict request rejection, server-owned fields and explicit no-write results. The full production CI remains required before merge.
