# SDD 004 — Supplier Mirror and Stock Risk Daemon

## Intent

Make supplier observations durable and continuously evaluate linked MercadoLibre Chile listings without combining scraping, persistence, business rules and remote writes in one manager.

## Business outcome

For every configured supplier SKU and linked listing, the system must preserve current and previous stock/cost, detect safe pause/reactivation opportunities, schedule margin reaudits after cost changes and create only approval-gated marketplace proposals.

## Business modules

### Supplier Mirror

Owns append-only supplier observations and the current/previous product state.

### Stock Risk

Owns supplier-product links, per-link recovery confirmation, bounded leases, deterministic assessment persistence and availability proposals.

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

## Ordered and idempotent ingestion

Observation material is serialized with stable object-key ordering and hashed with SHA-256.

Under a PostgreSQL advisory transaction lock scoped to `supplierSourceId + SKU`:

1. source scope and configured source type are verified;
2. an exact duplicate content hash returns the current state without changing counters;
3. a different observation whose timestamp is older than or equal to current state is rejected and rolled back;
4. a new ordered observation is appended once and advances current/previous stock and cost;
5. product-level successful-sync telemetry advances only for new successful observations;
6. each linked listing keeps its own recovery confirmation count;
7. that count advances only for a new successful observation above the link's recovery threshold and resets otherwise;
8. linked stock audits become due.

This prevents delayed scraper responses from rolling the mirror backward and prevents repeated delivery of one observation from satisfying recovery debounce.

## Link scope

A listing may link to multiple supplier sources, but at most one SKU for the same:

`account + listing + supplierSource`

This keeps the application port unambiguous while allowing primary and fallback suppliers.

## Stock audit input

The PostgreSQL adapter combines:

- supplier source configuration;
- current/previous supplier product state;
- per-link recovery confirmation count and policy;
- current MercadoLibre listing read model;
- current economic product-cost observation;
- latest profitability snapshot.

A profitability snapshot is authoritative for reactivation only when it matches the requested account and listing, the current listing price, the current economic product-cost amount and the product-cost evidence reference. Otherwise profitability is exposed as `unknown` and reactivation remains blocked.

Only `active` and `paused` MercadoLibre listings are eligible for availability auditing.

## Recovery debounce

The first new successful observation above the configured recovery threshold records confirmation `1` and may emit a recovery signal, but cannot reactivate a listing when policy requires two confirmations.

A later unique successful observation that remains above the threshold records confirmation `2`. Reactivation is considered only when:

- the source is online;
- evidence is fresh;
- the listing is paused;
- the per-link confirmation count satisfies policy;
- profitability is verified against current price and cost;
- the current supplier cost is unchanged from the economically verified cost.

Every resulting proposal remains `pending-approval`.

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
- listing links, confirmation counters and policies;
- stock assessments with policy version;
- approval-gated availability proposals.

Assessments and proposals are idempotent by canonical content hash. Assessment time is excluded from the decision hash so repeated evaluation of unchanged state does not duplicate artifacts, while a policy-version change creates a distinct assessment.

## Trust boundaries

- Manual, own and unverified sources never create automatic availability proposals.
- Online sources still require fresh evidence and policy gates.
- All pause/reactivation proposals remain `pending-approval`.
- Supplier observations cannot directly mutate MercadoLibre.
- Cost changes force Profit Engine reevaluation before reactivation.
- Old, mismatched or incomplete profitability snapshots cannot authorize reactivation.
- Out-of-order observations cannot replace current state.
- Cross-account and cross-source data are rejected.

## Acceptance criteria

- First supplier observation creates current state.
- Exact duplicate content is not appended twice and changes no confirmation counter.
- A different out-of-order observation is rejected and cannot replace current state.
- First unique successful observation above a link threshold records confirmation `1` and creates no reactivation proposal when policy requires two.
- Second unique successful observation above the threshold records confirmation `2`.
- A failed sync or stock at/below threshold resets the link confirmation count.
- Profitability that does not match current listing price, product cost and evidence is treated as unknown.
- Competing workers cannot lease the same link.
- Verified confirmed recovery creates one idempotent reactivation proposal.
- Proposal remains pending approval and preserves policy version.
- Repeated identical audits create no duplicate assessment or proposal.
- Production smoke executes migrations, ordered ingestion, economic verification, leasing and evaluation against PostgreSQL.
- Worker runs stock audit independently from other processors.
