# SDD 004 — Supplier Mirror and Stock Risk Daemon

## Intent

Make supplier observations durable and continuously evaluate linked MercadoLibre Chile listings without combining scraping, persistence, business rules and remote writes in one manager.

## Business outcome

For every configured supplier SKU and linked listing, the system must preserve current and previous stock/cost, detect safe pause/reactivation opportunities, schedule margin reaudits after cost changes and create only approval-gated marketplace proposals.

## Business modules

### Supplier Mirror

Owns append-only supplier observations and the current/previous product state.

### Stock Risk

Owns supplier-product links, bounded leases, deterministic assessment persistence and availability proposals.

### Profit Engine integration

Supplier cost changes schedule an existing economic policy for immediate margin reaudit. Stock recovery cannot bypass economic verification.

## Observation contract

An observation contains:

- organization and account scope;
- supplier source and source type;
- supplier SKU and name;
- observed stock and unit cost;
- sync success state;
- evidence identity, timestamp and hash.

Observation and evidence timestamps must match. Invalid observations are rejected before reaching PostgreSQL.

## Idempotent ingestion

The observation content is hashed with SHA-256.

Under a PostgreSQL advisory transaction lock scoped to `supplierSourceId + SKU`:

1. the source scope and configured source type are verified;
2. the append-only observation is inserted once;
3. duplicate content returns the current state without incrementing recovery counters;
4. a unique new observation advances current/previous stock and cost;
5. successful sync counters increment only for new successful observations;
6. failed sync resets the consecutive-success counter;
7. linked stock audits become due.

## Link scope

A listing may link to multiple supplier sources, but at most one SKU for the same:

`account + listing + supplierSource`

This keeps the application port unambiguous while allowing primary and fallback suppliers.

## Stock audit input

The PostgreSQL adapter combines:

- supplier source configuration;
- current/previous supplier product state;
- supplier-listing policy;
- current MercadoLibre listing read model;
- latest profitability snapshot.

Only `active` and `paused` MercadoLibre listings are eligible for availability auditing.

## Bounded daemon

Candidates use `FOR UPDATE SKIP LOCKED` and lease-owner compare-and-set completion/failure.

The daemon:

- receives a bounded batch size;
- calls `SupplierStockService`;
- persists assessment and optional proposal;
- releases successful candidates to the next scheduled audit;
- releases failures to deterministic retry;
- contains no LLM and performs no remote mutation.

## Durable artifacts

- supplier sources;
- current supplier products;
- append-only observations;
- listing links and policies;
- stock assessments;
- approval-gated availability proposals.

Assessments and proposals are idempotent by content hash. Assessment time is excluded from the decision hash so repeated evaluation of unchanged state does not duplicate artifacts.

## Trust boundaries

- Manual, own and unverified sources never create automatic availability proposals.
- Online sources still require evidence and policy gates.
- All pause/reactivation proposals remain `pending-approval`.
- Supplier observations cannot directly mutate MercadoLibre.
- Cost changes force Profit Engine reevaluation before reactivation.
- Cross-account and cross-source data are rejected.

## Acceptance criteria

- First supplier observation creates current state and recovery counter 1.
- Identical observation is not appended twice and does not increment the counter.
- Second unique successful observation preserves previous state and increments the counter.
- Competing workers cannot lease the same link.
- Verified recovery creates one idempotent reactivation proposal.
- Proposal remains pending approval.
- Repeated identical audits create no duplicate assessment or proposal.
- Production smoke executes migrations, ingestion, leasing and evaluation against PostgreSQL.
- Worker runs stock audit independently from other processors.
