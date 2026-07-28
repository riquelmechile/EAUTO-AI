# SDD 004 — Durable Supplier Mirror and Stock-Risk Daemon

## Intent

Make the Supplier/Stock domain durable and continuously executable without granting the daemon authority to mutate MercadoLibre.

## Vertical slice

```text
Supplier observation
        ↓
SupplierMirrorService
        ↓
PostgresSupplierStockRepository
        ↓
SupplierStockDaemon
        ↓
SupplierStockService
        ↓
assessment + approval-gated proposal + margin reaudit
```

## Sources of truth

- `supplier_stock_observations`: immutable evidence-backed observations.
- `supplier_listing_links`: current mirror state, policy and lease state.
- `supplier_stock_assessments`: immutable deterministic outcomes.
- `stock_availability_proposals`: pending human decisions.
- `economic_cost_observations`: authoritative product cost consumed by Profit Engine.

## Ingestion invariants

- An observation is scoped by organization, account, listing and supplier source.
- Source type must match the configured supplier source.
- Inactive sources reject observations.
- Unit cost requires explicit cost evidence.
- Duplicate content hashes return `duplicate` and do not change counters.
- Failed syncs are recorded but do not overwrite last-known stock or cost.
- Successful cost observations update `product-cost` and schedule margin audit.

## Recovery counter

Consecutive recovery syncs increment only when:

- sync succeeded;
- current stock is above the configured recovery threshold.

The counter resets when sync fails or stock is not above the threshold. The first transition from low stock to recovered stock starts at one.

## Worker contract

The stock-risk daemon:

- claims due links with `FOR UPDATE SKIP LOCKED`;
- evaluates at most the configured batch size;
- persists assessments and proposals idempotently;
- releases successful candidates with the next evaluation time;
- releases failures with a bounded retry time and sanitized error;
- cannot stop other processors in the shared worker.

## Idempotency

- Observation identity uses a content hash over the scoped command.
- Assessment identity excludes volatile evaluation time.
- Proposal identity includes scope, evidence, policy and requested transition.
- Repeating the same observation or evaluation cannot create duplicate business artifacts.

## Marketplace authority

The daemon creates only `pending-approval` proposals:

- `listing.pause`;
- `listing.reactivate`.

No MercadoLibre write client is invoked in this slice.

## Acceptance criteria

- Duplicate supplier responses are ignored without state drift.
- Two workers cannot lease the same link simultaneously.
- Successful supplier cost evidence feeds Profit Engine.
- Zero online stock creates one pending pause proposal.
- Repeated evaluation preserves one assessment and one proposal.
- Worker logs supplier processing separately from outbox, MercadoLibre and intelligence.
- Fresh PostgreSQL migrations and the full supplier flow pass in CI.
