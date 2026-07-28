# SDD 003 — Supplier Mirror and Stock Autopilot Domain

## Intent

Port the highest-value supplier and stock invariants from MSL and kiiess into EAUTO-AI without copying their orchestration monoliths or granting direct marketplace authority.

## Business outcome

The system must identify stock risk, cost changes and safe recovery conditions while preventing cancellations, reputation damage and reactivation of unprofitable listings.

## Architectural rule

This slice contains domain and application contracts only.

- Domain owns stock eligibility, recovery debounce, cost-change detection and proposal rules.
- Application owns ports, scope validation, persistence orchestration and margin-reaudit scheduling.
- Infrastructure adapters and supplier scraping are separate later slices.
- The LLM does not calculate stock transitions or authorize visible changes.

## Source types

| Source | Automatic availability proposal allowed |
| --- | --- |
| `online` | Yes, when all evidence and policy gates pass |
| `manual` | No |
| `own` | No |
| `unverified` | No |

This preserves the kiiess guard that manual, own and unverified sources must never toggle marketplace availability automatically.

## Pause rule

An approval-gated pause proposal may be created only when:

- the source is `online`;
- the supplier sync succeeded;
- stock evidence is fresh;
- current supplier stock is zero;
- the listing is currently active.

The proposal never executes the MercadoLibre mutation.

## Reactivation rule

An approval-gated reactivation proposal may be created only when:

- the source is `online`;
- the supplier sync succeeded;
- stock evidence is fresh;
- stock crossed from at-or-below the recovery threshold to above it;
- at least the configured number of consecutive successful recovery syncs exists;
- the listing is currently paused;
- profitability is verified as `profitable`;
- cost evidence is fresh;
- the observed supplier cost has not changed since the verified economics.

If economics are not verified, a margin reaudit is scheduled instead.

## Signals

The deterministic assessment may emit:

- `sync.failure`;
- `stock.recovered`;
- `cost.change`;
- `margin.reaudit-required`;
- `evidence.stale`.

Signals are evidence-backed artifacts, not remote actions.

## Cost changes

A material cost change is measured in basis points against the previous unit cost. When the absolute change reaches the policy threshold:

- a `cost.change` signal is emitted;
- a `margin.reaudit-required` signal is emitted;
- reactivation is blocked until economics are recomputed.

## Trust and approval

Every pause or reactivation proposal:

- contains organization, account, listing and supplier scope;
- contains evidence references and policy version;
- has `requiresApproval: true`;
- is separate from execution.

This preserves the operational decision that visible MercadoLibre stock and publication status changes require CEO approval.

## Acceptance criteria

- Online zero stock creates an approval-gated pause proposal.
- Manual, own and unverified sources never create availability proposals.
- Reactivation requires two or more configured successful recovery syncs.
- Reactivation requires verified profitable economics.
- Material cost change blocks reactivation and schedules margin reaudit.
- Stale stock evidence blocks availability proposals and emits an explicit signal.
- Sync failure emits a critical signal and no availability proposal.
- Application ports reject cross-account data.
