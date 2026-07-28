# SDD 002 — Economic Persistence and Margin Audit

## Intent

Turn the deterministic Profit Engine into a durable, continuously evaluated business capability without giving an LLM authority over formulas, evidence, scheduling or execution.

## Business outcome

For every configured MercadoLibre Chile listing, the system must be able to answer with evidence:

- Is the listing profitable?
- Is it below the account margin floor?
- Is any required economic input missing or stale?
- Is a repricing proposal mathematically justified?
- Has the same evidence already produced the same snapshot, finding or proposal?

## Architectural boundaries

### Domain

Owns economic cost kinds, profitability formulas, margin classification and repricing policy.

### Application

Owns the `ProfitEngineService`, candidate leasing contracts and the bounded `MarginAuditDaemon` loop.

### Infrastructure

Owns PostgreSQL tables, MercadoLibre listing read-model access, leases, hashes and durable persistence.

### Worker

May call the daemon repeatedly, but may not calculate margin, infer missing costs or execute price writes.

## Inputs

Authoritative listing data comes from `mercadolibre_listing_snapshots`.

Economic policies and observations come from:

- `economic_listing_policies`
- `economic_cost_observations`

Required evidence:

- marketplace fee rate;
- product cost;
- fulfillment cost.

Optional evidence:

- packaging;
- Ads;
- returns;
- discounts;
- import cost;
- other attributable cost.

## Fail-closed rules

- Missing policy means the listing is not eligible for scheduled auditing.
- Missing listing read model makes the audit fail and retry.
- Missing fee or required costs produces an `incomplete` snapshot.
- Stale evidence produces an `incomplete` snapshot.
- No missing value is silently estimated.
- An incomplete snapshot never creates a repricing proposal.
- A proposal never executes a remote mutation.

## Leasing and bounded execution

Candidates are claimed with `FOR UPDATE SKIP LOCKED`.

Each lease has:

- worker owner;
- lease expiry;
- deterministic success schedule;
- deterministic retry schedule;
- bounded batch size.

A worker crash allows another worker to reclaim after expiry.

## Idempotency

Snapshots, findings and proposals use SHA-256 content hashes with unique constraints.

Identical evidence and policy must not create duplicate durable artifacts.

## Margin finding mapping

| Profitability status | Finding severity |
| -------------------- | ---------------- |
| `profitable`         | `none`           |
| `below-floor`        | `warning`        |
| `loss`               | `critical`       |
| `incomplete`         | `blocked`        |

Healthy findings are persisted to prove that a listing was evaluated, not merely ignored.

## LLM boundary

The base audit loop uses no LLM.

A future agent may explain or challenge a finding only after the deterministic artifact exists. It receives stable policy and skill contracts as the cacheable prefix and volatile evidence at the end of the prompt.

## Acceptance criteria

- Fresh PostgreSQL migrations create all economic tables.
- A configured listing can be read from the MercadoLibre snapshot plus economic observations.
- Competing workers cannot lease the same listing simultaneously.
- A below-floor listing creates a warning finding.
- Identical runs are idempotent.
- Repricing remains approval-gated.
- Production smoke executes the full flow.
- Production doctor requires the migration and smoke script.
