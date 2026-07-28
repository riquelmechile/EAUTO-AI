import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type {
  EconomicCostComponent,
  EconomicCostKind,
  MercadoLibreListingSnapshot,
  ProfitabilityInput,
  ProfitabilitySnapshot,
  RepricingProposal,
} from "@eauto/domain";
import type {
  ForLeasingMarginAuditCandidates,
  ForReadingEconomicInputs,
  ForSavingMarginAuditFindings,
  ForSavingProfitSnapshots,
  ForSavingRepricingProposals,
  MarginAuditCandidate,
  MarginAuditFinding,
} from "@eauto/application";

export class PostgresProfitEngineRepository
  implements
    ForReadingEconomicInputs,
    ForSavingProfitSnapshots,
    ForSavingRepricingProposals,
    ForLeasingMarginAuditCandidates,
    ForSavingMarginAuditFindings
{
  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async read(accountId: string, listingId: string): Promise<ProfitabilityInput> {
    const listingResult = await this.pool.query<{
      organization_id: string;
      minimum_margin_bps: number;
      payload_json: MercadoLibreListingSnapshot;
      variable_rate_bps: number | null;
      variable_rate_evidence_id: string | null;
      variable_rate_evidence_source: string | null;
      variable_rate_observed_at: Date | string | null;
      variable_rate_content_hash: string | null;
      maximum_evidence_age_ms: string;
    }>(
      `SELECT account.organization_id, account.minimum_margin_bps, listing.payload_json,
         policy.variable_rate_bps, policy.variable_rate_evidence_id,
         policy.variable_rate_evidence_source, policy.variable_rate_observed_at,
         policy.variable_rate_content_hash, policy.maximum_evidence_age_ms::text
       FROM economic_listing_policies policy
       JOIN commerce_accounts account
         ON account.organization_id = policy.organization_id AND account.id = policy.account_id
       JOIN mercadolibre_listing_snapshots listing
         ON listing.account_id = policy.account_id AND listing.item_id = policy.listing_id
       WHERE policy.account_id = $1 AND policy.listing_id = $2
       LIMIT 1`,
      [accountId, listingId],
    );
    const row = listingResult.rows[0];
    if (!row) throw new Error(`Economic listing ${accountId}/${listingId} was not found.`);
    const listing = row.payload_json;
    if (listing.accountId !== accountId || listing.itemId !== listingId) {
      throw new Error("MercadoLibre listing snapshot is outside the requested economic scope.");
    }

    const costResult = await this.pool.query<{
      cost_kind: EconomicCostKind;
      amount_minor: string;
      evidence_id: string;
      evidence_source: string;
      observed_at: Date | string;
      content_hash: string;
    }>(
      `SELECT cost_kind, amount_minor::text, evidence_id, evidence_source, observed_at, content_hash
       FROM economic_cost_observations
       WHERE account_id = $1 AND listing_id = $2
       ORDER BY cost_kind ASC`,
      [accountId, listingId],
    );
    const costs: readonly EconomicCostComponent[] = Object.freeze(
      costResult.rows.map((cost) =>
        Object.freeze({
          kind: cost.cost_kind,
          amountMinor: toSafeInteger(cost.amount_minor, `cost:${cost.cost_kind}`),
          evidence: Object.freeze({
            id: cost.evidence_id,
            source: cost.evidence_source,
            observedAt: toIso(cost.observed_at),
            contentHash: cost.content_hash,
          }),
        }),
      ),
    );
    const hasVariableRateEvidence =
      row.variable_rate_bps !== null &&
      row.variable_rate_evidence_id !== null &&
      row.variable_rate_evidence_source !== null &&
      row.variable_rate_observed_at !== null &&
      row.variable_rate_content_hash !== null;

    return Object.freeze({
      accountId,
      listingId,
      currency: "CLP" as const,
      salePriceMinor: listing.priceMinor,
      quantity: 1,
      variableRateBps: hasVariableRateEvidence ? (row.variable_rate_bps as number) : null,
      variableRateEvidence: hasVariableRateEvidence
        ? Object.freeze({
            id: row.variable_rate_evidence_id as string,
            source: row.variable_rate_evidence_source as string,
            observedAt: toIso(row.variable_rate_observed_at as Date | string),
            contentHash: row.variable_rate_content_hash as string,
          })
        : null,
      costs,
      minimumMarginBps: row.minimum_margin_bps,
      asOf: this.now().toISOString(),
      maximumEvidenceAgeMs: toSafeInteger(
        row.maximum_evidence_age_ms,
        "maximumEvidenceAgeMs",
      ),
    });
  }

  async save(value: ProfitabilitySnapshot): Promise<void>;
  async save(value: RepricingProposal): Promise<void>;
  async save(value: MarginAuditFinding): Promise<void>;
  async save(value: ProfitabilitySnapshot | RepricingProposal | MarginAuditFinding): Promise<void> {
    if ("severity" in value) {
      await this.persistFinding(value);
      return;
    }
    if ("proposedPriceMinor" in value) {
      await this.persistProposal(value);
      return;
    }
    await this.persistSnapshot(value);
  }

  async claim(input: {
    owner: string;
    now: string;
    leaseUntil: string;
    limit: number;
  }): Promise<readonly MarginAuditCandidate[]> {
    const result = await this.pool.query<MarginAuditCandidate>(
      `WITH candidates AS (
         SELECT account_id, listing_id
         FROM economic_listing_policies
         WHERE next_audit_at <= $2
           AND (lease_until IS NULL OR lease_until <= $2)
         ORDER BY next_audit_at ASC, account_id ASC, listing_id ASC
         LIMIT $4
         FOR UPDATE SKIP LOCKED
       )
       UPDATE economic_listing_policies policy
       SET lease_owner = $1, lease_until = $3, updated_at = now()
       FROM candidates
       WHERE policy.account_id = candidates.account_id
         AND policy.listing_id = candidates.listing_id
       RETURNING policy.organization_id AS "organizationId",
         policy.account_id AS "accountId", policy.listing_id AS "listingId"`,
      [input.owner, input.now, input.leaseUntil, input.limit],
    );
    return result.rows.map((candidate) => Object.freeze(candidate));
  }

  async complete(input: {
    candidate: MarginAuditCandidate;
    owner: string;
    nextAuditAt: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `UPDATE economic_listing_policies
       SET lease_owner = NULL, lease_until = NULL, next_audit_at = $5,
           last_error = NULL, updated_at = now()
       WHERE organization_id = $1 AND account_id = $2 AND listing_id = $3
         AND lease_owner = $4`,
      [
        input.candidate.organizationId,
        input.candidate.accountId,
        input.candidate.listingId,
        input.owner,
        input.nextAuditAt,
      ],
    );
    if (result.rowCount !== 1) throw new Error("Margin audit lease was lost before completion.");
  }

  async fail(input: {
    candidate: MarginAuditCandidate;
    owner: string;
    retryAt: string;
    error: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `UPDATE economic_listing_policies
       SET lease_owner = NULL, lease_until = NULL, next_audit_at = $5,
           last_error = $6, updated_at = now()
       WHERE organization_id = $1 AND account_id = $2 AND listing_id = $3
         AND lease_owner = $4`,
      [
        input.candidate.organizationId,
        input.candidate.accountId,
        input.candidate.listingId,
        input.owner,
        input.retryAt,
        input.error,
      ],
    );
    if (result.rowCount !== 1) throw new Error("Margin audit lease was lost before failure release.");
  }

  private async persistSnapshot(snapshot: ProfitabilitySnapshot): Promise<void> {
    const organizationId = await this.organizationFor(snapshot.accountId);
    const contentHash = hashCanonical(snapshot);
    const calculatedAt =
      snapshot.status === "incomplete" ? this.now().toISOString() : snapshot.calculatedAt;
    await this.pool.query(
      `INSERT INTO profitability_snapshots
        (id, organization_id, account_id, listing_id, status, calculated_at,
         content_hash, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (content_hash) DO NOTHING`,
      [
        `profit_${contentHash}`,
        organizationId,
        snapshot.accountId,
        snapshot.listingId,
        snapshot.status,
        calculatedAt,
        contentHash,
        JSON.stringify(snapshot),
      ],
    );
  }

  private async persistProposal(proposal: RepricingProposal): Promise<void> {
    const organizationId = await this.organizationFor(proposal.accountId);
    const contentHash = hashCanonical(proposal);
    await this.pool.query(
      `INSERT INTO repricing_proposals
        (id, organization_id, account_id, listing_id, status, current_price_minor,
         proposed_price_minor, policy_version, content_hash, payload_json)
       VALUES ($1, $2, $3, $4, 'pending-approval', $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT (content_hash) DO NOTHING`,
      [
        `reprice_${contentHash}`,
        organizationId,
        proposal.accountId,
        proposal.listingId,
        proposal.currentPriceMinor,
        proposal.proposedPriceMinor,
        proposal.policyVersion,
        contentHash,
        JSON.stringify(proposal),
      ],
    );
  }

  private async persistFinding(finding: MarginAuditFinding): Promise<void> {
    const contentHash = hashCanonical({
      organizationId: finding.organizationId,
      accountId: finding.accountId,
      listingId: finding.listingId,
      status: finding.status,
      severity: finding.severity,
      snapshot: finding.snapshot,
    });
    await this.pool.query(
      `INSERT INTO margin_audit_findings
        (id, organization_id, account_id, listing_id, status, severity,
         observed_at, content_hash, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT (content_hash) DO NOTHING`,
      [
        `margin_${contentHash}`,
        finding.organizationId,
        finding.accountId,
        finding.listingId,
        finding.status,
        finding.severity,
        finding.observedAt,
        contentHash,
        JSON.stringify(finding),
      ],
    );
  }

  private async organizationFor(accountId: string): Promise<string> {
    const result = await this.pool.query<{ organization_id: string }>(
      `SELECT organization_id FROM commerce_accounts WHERE id = $1`,
      [accountId],
    );
    const organizationId = result.rows[0]?.organization_id;
    if (!organizationId) throw new Error(`Commerce account ${accountId} was not found.`);
    return organizationId;
  }
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toSafeInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${field} exceeded safe integer range.`);
  return parsed;
}
