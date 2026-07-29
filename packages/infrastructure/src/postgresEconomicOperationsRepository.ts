import type { Pool } from "pg";
import type { EconomicCostKind, ProfitabilitySnapshot } from "@eauto/domain";
import type {
  EconomicCoverageRow,
  EconomicEvidenceRow,
  EconomicOperationsRepository,
  EconomicStatusReport,
} from "@eauto/application";

export class PostgresEconomicOperationsRepository implements EconomicOperationsRepository {
  constructor(private readonly pool: Pool) {}

  async listEconomicListingIds(input: {
    organizationId: string;
    accountId: string;
    limit: number;
  }): Promise<readonly string[]> {
    const result = await this.pool.query<{ listing_id: string }>(
      `SELECT listing_id FROM economic_listing_policies
       WHERE organization_id=$1 AND account_id=$2 ORDER BY listing_id ASC LIMIT $3`,
      [input.organizationId, input.accountId, input.limit],
    );
    return Object.freeze(result.rows.map((row) => row.listing_id));
  }

  async economicStatus(input: {
    organizationId: string;
    accountId: string;
  }): Promise<EconomicStatusReport> {
    const result = await this.pool.query<{
      listing_count: string;
      policy_count: string;
      cost_observation_count: string;
      complete_snapshot_count: string;
      incomplete_snapshot_count: string;
      latest_calculated_at: Date | string | null;
    }>(
      `SELECT
         (SELECT count(*) FROM mercadolibre_listing_snapshots WHERE organization_id=$1 AND account_id=$2)::text AS listing_count,
         (SELECT count(*) FROM economic_listing_policies WHERE organization_id=$1 AND account_id=$2)::text AS policy_count,
         (SELECT count(*) FROM economic_cost_observations WHERE organization_id=$1 AND account_id=$2)::text AS cost_observation_count,
         (SELECT count(*) FROM profitability_snapshots WHERE organization_id=$1 AND account_id=$2 AND status <> 'incomplete')::text AS complete_snapshot_count,
         (SELECT count(*) FROM profitability_snapshots WHERE organization_id=$1 AND account_id=$2 AND status = 'incomplete')::text AS incomplete_snapshot_count,
         (SELECT max(calculated_at) FROM profitability_snapshots WHERE organization_id=$1 AND account_id=$2) AS latest_calculated_at`,
      [input.organizationId, input.accountId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Economic status query returned no row.");
    return Object.freeze({
      organizationId: input.organizationId,
      accountId: input.accountId,
      listingCount: safeInteger(row.listing_count, "listingCount"),
      policyCount: safeInteger(row.policy_count, "policyCount"),
      costObservationCount: safeInteger(row.cost_observation_count, "costObservationCount"),
      completeSnapshotCount: safeInteger(row.complete_snapshot_count, "completeSnapshotCount"),
      incompleteSnapshotCount: safeInteger(
        row.incomplete_snapshot_count,
        "incompleteSnapshotCount",
      ),
      latestCalculatedAt: row.latest_calculated_at ? iso(row.latest_calculated_at) : null,
    });
  }

  async economicCoverage(input: {
    organizationId: string;
    accountId: string;
    limit: number;
  }): Promise<readonly EconomicCoverageRow[]> {
    const result = await this.pool.query<{
      listing_id: string;
      variable_rate_bps: number | null;
      observed_cost_kinds: EconomicCostKind[];
      latest_status: ProfitabilitySnapshot["status"] | null;
      latest_calculated_at: Date | string | null;
    }>(
      `SELECT policy.listing_id,policy.variable_rate_bps,
         coalesce(array_agg(DISTINCT cost.cost_kind) FILTER (WHERE cost.cost_kind IS NOT NULL),'{}') AS observed_cost_kinds,
         latest.status AS latest_status,latest.calculated_at AS latest_calculated_at
       FROM economic_listing_policies policy
       LEFT JOIN economic_cost_observations cost
         ON cost.organization_id=policy.organization_id AND cost.account_id=policy.account_id
        AND cost.listing_id=policy.listing_id
       LEFT JOIN LATERAL (
         SELECT status,calculated_at FROM profitability_snapshots snapshot
         WHERE snapshot.organization_id=policy.organization_id AND snapshot.account_id=policy.account_id
           AND snapshot.listing_id=policy.listing_id
         ORDER BY calculated_at DESC LIMIT 1
       ) latest ON true
       WHERE policy.organization_id=$1 AND policy.account_id=$2
       GROUP BY policy.listing_id,policy.variable_rate_bps,latest.status,latest.calculated_at
       ORDER BY policy.listing_id ASC LIMIT $3`,
      [input.organizationId, input.accountId, input.limit],
    );
    return Object.freeze(
      result.rows.map((row) => {
        const observed = Object.freeze([...row.observed_cost_kinds].sort());
        const missing = [
          row.variable_rate_bps === null ? "marketplace-fee-rate" : null,
          observed.includes("product-cost") ? null : "product-cost",
          observed.includes("fulfillment-cost") ? null : "fulfillment-cost",
        ].filter((value): value is string => value !== null);
        return Object.freeze({
          listingId: row.listing_id,
          observedCostKinds: observed,
          missingRequiredInputs: Object.freeze(missing),
          latestStatus: row.latest_status,
          latestCalculatedAt: row.latest_calculated_at ? iso(row.latest_calculated_at) : null,
        });
      }),
    );
  }

  async economicEvidence(input: {
    organizationId: string;
    accountId: string;
    listingId: string;
  }): Promise<EconomicEvidenceRow | null> {
    const policyResult = await this.pool.query<{
      variable_rate_evidence_id: string | null;
    }>(
      `SELECT variable_rate_evidence_id FROM economic_listing_policies
       WHERE organization_id=$1 AND account_id=$2 AND listing_id=$3`,
      [input.organizationId, input.accountId, input.listingId],
    );
    if (!policyResult.rows[0]) return null;
    const [costResult, snapshot] = await Promise.all([
      this.pool.query<{
        cost_kind: EconomicCostKind;
        evidence_id: string;
        evidence_source: string;
        observed_at: Date | string;
        content_hash: string;
      }>(
        `SELECT cost_kind,evidence_id,evidence_source,observed_at,content_hash
         FROM economic_cost_observations
         WHERE organization_id=$1 AND account_id=$2 AND listing_id=$3 ORDER BY cost_kind ASC`,
        [input.organizationId, input.accountId, input.listingId],
      ),
      this.latestProfitability(input),
    ]);
    return Object.freeze({
      listingId: input.listingId,
      variableRateEvidenceId: policyResult.rows[0].variable_rate_evidence_id,
      costEvidence: Object.freeze(
        costResult.rows.map((row) =>
          Object.freeze({
            kind: row.cost_kind,
            evidenceId: row.evidence_id,
            source: row.evidence_source,
            observedAt: iso(row.observed_at),
            contentHash: row.content_hash,
          }),
        ),
      ),
      latestSnapshot: snapshot,
    });
  }

  async latestProfitability(input: {
    organizationId: string;
    accountId: string;
    listingId: string;
  }): Promise<ProfitabilitySnapshot | null> {
    const result = await this.pool.query<{ payload_json: ProfitabilitySnapshot }>(
      `SELECT payload_json FROM profitability_snapshots
       WHERE organization_id=$1 AND account_id=$2 AND listing_id=$3
       ORDER BY calculated_at DESC LIMIT 1`,
      [input.organizationId, input.accountId, input.listingId],
    );
    return result.rows[0]?.payload_json ?? null;
  }
}

function safeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} exceeded safe integer range.`);
  return parsed;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
