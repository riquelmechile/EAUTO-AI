# SDD 017 — MercadoLibre `question.answer` Write Slice

## Status

Accepted for code integration. Live activation remains blocked by the production gates tracked in issue #41.

## Context

EAUTO-AI keeps MercadoLibre mutations fail-closed. The first candidate mutation is answering a seller question because it is narrow, directly verifiable and can remain permanently behind human approval. The global write block must not become a marketplace-wide feature flag.

MercadoLibre exposes `POST /answers` with `question_id` and UTF-8 `text`, and the resulting state can be verified with `GET /questions/{question_id}?api_version=4`.

## Decision

Implement a dedicated `ActionExecutor` for exactly `question.answer`.

The executor:

1. accepts one server-owned account allowlist entry;
2. requires the exact server-owned policy version;
3. requires an action already transitioned to `executing` by `ActionService`;
4. requires exactly one approved change: `answer.text`, from `null` to a non-empty string of at most 2,000 characters;
5. preflights the remote question before mutation;
6. verifies that the remote seller matches the OAuth credential seller;
7. treats an identical existing answer as idempotent and a different existing answer as a conflict;
8. posts only to the fixed official MercadoLibre API host;
9. returns a sanitized provider receipt without buyer identity or question text;
10. re-reads the question after execution and verifies the exact approved answer hash and active status.

## Invariants

- `assertMercadoLibreWriteDisabled()` remains unchanged and remains the default.
- `assertMercadoLibreWriteAllowed()` accepts only an explicit `question.answer` grant with a non-empty policy version.
- Every other `ACTION_KIND` is rejected before credentials or HTTP are used.
- The executor never proposes, reviews or approves an action; it only receives `executing` or `executed` actions from `ActionService`.
- The access token is supplied by an internal credential port and is never persisted in receipts, logs or action payloads.
- The API base URL is fixed to `https://api.mercadolibre.com` and redirects are rejected.
- Remote seller mismatch, response mismatch, invalid JSON, timeout or verification failure fail closed.
- A failed or ambiguous external operation is handled by the existing `ActionService` transition to `uncertain`; there is no blind retry.
- This slice does not enable `inform` or `autonomous` mode.

## Live activation gate

The adapter remains unconfigured until:

- Plasticov OAuth is active and one refresh has been observed;
- the read model has passed the five-day reconciliation gate;
- an account-specific policy version is selected;
- the action is wired to the rotating OAuth credential provider;
- the operator approves every answer manually;
- the receipt chain is compared with the published answer for two weeks.

Maustian is explicitly outside the first activation.

## Tests

The contract tests cover:

- ownership preflight;
- exact POST payload and Bearer authorization;
- sanitized receipt;
- remote verification;
- exact-answer idempotency;
- global blocking of all other action kinds;
- account, policy, seller and length mismatch rejection.

## Consequences

The codebase has a real, narrow MercadoLibre write adapter without weakening the global boundary. Production still cannot mutate MercadoLibre until the credential adapter is wired and the live gates are evidenced.
