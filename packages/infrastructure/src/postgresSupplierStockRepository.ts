import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  MercadoLibreListingSnapshot,
  ProfitabilitySnapshot,
  StockAvailabilityProposal,
  StockSourceType,
  SupplierStockAssessment,
  SupplierStockInput,
} from "@eauto/domain";
import type {
  ForLeasingSupplierStockCandidates,
  ForReadingSupplierStockInputs,
  ForRecordingSupplierMirrorObservations,
  ForSavingStockAvailabilityProposals,
  ForSavingSupplierStockAssessments,
  ForSchedulingMarginReaudits,
  SupplierMirrorObservation,
  SupplierStockCandidate,
} from "@eauto/application";

export class PostgresSupplierStockRepository
  implements
    ForRecordingSupplierMirrorObservations,
    ForReadingSupplierStockInputs,
    ForSavingSupplierStockAssessments,
    ForSavingStockAvailabilityProposals,
    ForSchedulingMarginReaudits,
    ForLeasingSupplierStockCandidates
{
  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async record(observation: SupplierMirrorObservation): Promise<"recorded" | "duplicate"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const linkResult = await client.query<{
        source_type: StockSourceType;
        active: boolean;
        recovery_stock_threshold: number;
        current_stock: number;
        consecutive_successful_syncs: number;
        current_unit_cost_minor: string | null;
      }>(
        `SELECT source.source_type, source.active, link.recovery_stock_threshold,
           link.current_stock, link.consecutive_successful_syncs,
           link.current_unit_cost_minor::text
         FROM supplier_listing_links link
         JOIN supplier_sources source
           ON source.organization_id = link.organization_id
          AND source.account_id = link.account_id
          AND source.id = link.supplier_source_id
         WHERE link.organization_id = $1 AND link.account_id = $2
           AND link.listing_id = $3 AND link.supplier_source_id = $4
         FOR UPDATE`,
        [
          observation.organizationId,
          observation.accountId,
          observation.listingId,
          observation.supplierSourceId,
        ],
      );
      const link = linkResult.rows[0];
      if (!link) throw new Error("Supplier observation is outside a configured listing link.");
      if (!link.active) throw new Error("Supplier source is inactive.");
      if (link.source_type !== observation.sourceType) {
        throw new Error("Supplier observation source type does not match the configured source.");
      }

      const contentHash = hashCanonical(observation);
      const inserted = await client.query(
        `INSERT INTO supplier_stock_observations
          (id, organization_id, account_id, listing_id, supplier_source_id, source_type,
           stock_quantity, unit_cost_minor, sync_succeeded, observed_at, content_hash, payload_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
         ON CONFLICT (content_hash) DO NOTHING
         RETURNING id`,
        [
          `supplier_observation_${contentHash}`,
          observation.organizationId,
          observation.accountId,
          observation.listingId,
          observation.supplierSourceId,
          observation.sourceType,
          observation.stockQuantity,
          observation.unitCostMinor,
          observation.syncSucceeded,
          observation.stockEvidence.observedAt,
          contentHash,
          JSON.stringify(observation),
        ],
      );
      if (inserted.rowCount !== 1) {
        await client.query("COMMIT");
        return "duplicate";
      }

      if (observation.syncSucceeded) {
        const recoverySyncs =
          observation.stockQuantity > link.recovery_stock_threshold
            ? link.current_stock <= link.recovery_stock_threshold
              ? 1
              : link.consecutive_successful_syncs + 1
            : 0;
        await client.query(
          `UPDATE supplier_listing_links
           SET previous_stock = current_stock,
               current_stock = $5,
               consecutive_successful_syncs = $6,
               sync_succeeded = true,
               previous_unit_cost_minor = current_unit_cost_minor,
               current_unit_cost_minor = $7,
               stock_evidence_id = $8,
               stock_evidence_source = $9,
               stock_observed_at = $10,
               stock_content_hash = $11,
               cost_evidence_id = $12,
               cost_evidence_source = $13,
               cost_observed_at = $14,
               cost_content_hash = $15,
               next_evaluation_at = LEAST(next_evaluation_at, $10),
               last_error = NULL,
               updated_at = now()
           WHERE organization_id = $1 AND account_id = $2
             AND listing_id = $3 AND supplier_source_id = $4`,
          [
            observation.organizationId,
            observation.accountId,
            observation.listingId,
            observation.supplierSourceId,
            observation.stockQuantity,
            recoverySyncs,
            observation.unitCostMinor,
            observation.stockEvidence.id,
            observation.stockEvidence.source,
            observation.stockEvidence.observedAt,
            observation.stockEvidence.contentHash,
            observation.costEvidence?.id ?? null,
            observation.costEvidence?.source ?? null,
            observation.costEvidence?.observedAt ?? null,
            observation.costEvidence?.contentHash ?? null,
          ],
        );
        if (observation.unitCostMinor !== null && observation.costEvidence) {
          await upsertProductCost(client, observation);
          await scheduleEconomicAudit(client, observation.accountId, observation.listingId);
        }
      } else {
        await client.query(
          `UPDATE supplier_listing_links
           SET sync_succeeded = false,
               consecutive_successful_syncs = 0,
               next_evaluation_at = LEAST(next_evaluation_at, $5),
               last_error = 'supplier-sync-failed',
               updated_at = now()
           WHERE organization_id = $1 AND account_id = $2
             AND listing_id = $3 AND supplier_source_id = $4`,
          [
            observation.organizationId,
            observation.accountId,
            observation.listingId,
            observation.supplierSourceId,
            observation.stockEvidence.observedAt,
          ],
        );
      }
      await client.query("COMMIT");
      return "recorded";
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async read(accountId: string, listingId: string): Promise<SupplierStockInput> {
    const result = await this.pool.query<{
      organization_id: string;
      supplier_source_id: string;
      source_type: StockSourceType;
      maximum_evidence_age_ms: string;
      previous_stock: number;
      current_stock: number;
      consecutive_successful_syncs: number;
      sync_succeeded: boolean;
      previous_unit_cost_minor: string | null;
      current_unit_cost_minor: string | null;
      stock_evidence_id: string | null;
      stock_evidence_source: string | null;
      stock_observed_at: Date | string | null;
      stock_content_hash: string | null;
      cost_evidence_id: string | null;
      cost_evidence_source: string | null;
      cost_observed_at: Date | string | null;
      cost_content_hash: string | null;
      listing_payload: MercadoLibreListingSnapshot;
      profitability_payload: ProfitabilitySnapshot | null;
    }>(
      `SELECT link.organization_id, link.supplier_source_id, source.source_type,
         source.maximum_evidence_age_ms::text, link.previous_stock, link.current_stock,
         link.consecutive_successful_syncs, link.sync_succeeded,
         link.previous_unit_cost_minor::text, link.current_unit_cost_minor::text,
         link.stock_evidence_id, link.stock_evidence_source, link.stock_observed_at,
         link.stock_content_hash, link.cost_evidence_id, link.cost_evidence_source,
         link.cost_observed_at, link.cost_content_hash, listing.payload_json AS listing_payload,
         profitability.payload_json AS profitability_payload
       FROM supplier_listing_links link
       JOIN supplier_sources source
         ON source.organization_id = link.organization_id
        AND source.account_id = link.account_id
        AND source.id = link.supplier_source_id
       JOIN mercadolibre_listing_snapshots listing
         ON listing.account_id = link.account_id AND listing.item_id = link.listing_id
       LEFT JOIN LATERAL (
         SELECT payload_json
         FROM profitability_snapshots
         WHERE account_id = link.account_id AND listing_id = link.listing_id
         ORDER BY calculated_at DESC, created_at DESC
         LIMIT 1
       ) profitability ON true
       WHERE link.account_id = $1 AND link.listing_id = $2 AND source.active = true
       LIMIT 1`,
      [accountId, listingId],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Supplier mirror ${accountId}/${listingId} was not found.`);
    if (
      !row.stock_evidence_id ||
      !row.stock_evidence_source ||
      !row.stock_observed_at ||
      !row.stock_content_hash
    ) {
      throw new Error("Supplier mirror has no successful stock observation.");
    }
    const listingStatus = row.listing_payload.status;
    if (listingStatus !== "active" && listingStatus !== "paused") {
      throw new Error(`Listing ${listingId} is not eligible for stock autopilot: ${listingStatus}.`);
    }
    const hasCostEvidence =
      row.current_unit_cost_minor !== null &&
      row.cost_evidence_id !== null &&
      row.cost_evidence_source !== null &&
      row.cost_observed_at !== null &&
      row.cost_content_hash !== null;

    return Object.freeze({
      organizationId: row.organization_id,
      accountId,
      listingId,
      supplierSourceId: row.supplier_source_id,
      sourceType: row.source_type,
      previousStock: row.previous_stock,
      currentStock: row.current_stock,
      consecutiveSuccessfulSyncs: row.consecutive_successful_syncs,
      syncSucceeded: row.sync_succeeded,
      listingStatus,
      previousUnitCostMinor:
        row.previous_unit_cost_minor === null
          ? null
          : toSafeInteger(row.previous_unit_cost_minor, "previousUnitCostMinor"),
      currentUnitCostMinor:
        row.current_unit_cost_minor === null
          ? null
          : toSafeInteger(row.current_unit_cost_minor, "currentUnitCostMinor"),
      profitabilityStatus: row.profitability_payload?.status ?? "unknown",
      stockEvidence: Object.freeze({
        id: row.stock_evidence_id,
        source: row.stock_evidence_source,
        observedAt: toIso(row.stock_observed_at),
        contentHash: row.stock_content_hash,
      }),
      costEvidence: hasCostEvidence
        ? Object.freeze({
            id: row.cost_evidence_id as string,
            source: row.cost_evidence_source as string,
            observedAt: toIso(row.cost_observed_at as Date | string),
            contentHash: row.cost_content_hash as string,
          })
        : null,
      asOf: this.now().toISOString(),
      maximumEvidenceAgeMs: toSafeInteger(
        row.maximum_evidence_age_ms,
        "maximumEvidenceAgeMs",
      ),
    });
  }

  async save(value: SupplierStockAssessment): Promise<void>;
  async save(value: StockAvailabilityProposal): Promise<void>;
  async save(value: SupplierStockAssessment | StockAvailabilityProposal): Promise<void> {
    if ("kind" in value) {
      const contentHash = hashCanonical(value);
      await this.pool.query(
        `INSERT INTO stock_availability_proposals
          (id, organization_id, account_id, listing_id, supplier_source_id, kind,
           status, policy_version, content_hash, payload_json)
         VALUES ($1,$2,$3,$4,$5,$6,'pending-approval',$7,$8,$9::jsonb)
         ON CONFLICT (content_hash) DO NOTHING`,
        [
          `stock_proposal_${contentHash}`,
          value.organizationId,
          value.accountId,
          value.listingId,
          value.supplierSourceId,
          value.kind,
          value.policyVersion,
          contentHash,
          JSON.stringify(value),
        ],
      );
      return;
    }
    const material = { ...value, evaluatedAt: undefined };
    const contentHash = hashCanonical(material);
    await this.pool.query(
      `INSERT INTO supplier_stock_assessments
        (id, organization_id, account_id, listing_id, supplier_source_id,
         evaluated_at, content_hash, payload_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (content_hash) DO NOTHING`,
      [
        `stock_assessment_${contentHash}`,
        value.organizationId,
        value.accountId,
        value.listingId,
        value.supplierSourceId,
        value.evaluatedAt,
        contentHash,
        JSON.stringify(value),
      ],
    );
  }

  async schedule(input: {
    organizationId: string;
    accountId: string;
    listingId: string;
    reason: string;
    evidenceRefs: readonly string[];
  }): Promise<void> {
    const result = await this.pool.query(
      `UPDATE economic_listing_policies
       SET next_audit_at = LEAST(next_audit_at, $4),
           last_error = NULL,
           updated_at = now()
       WHERE organization_id = $1 AND account_id = $2 AND listing_id = $3`,
      [input.organizationId, input.accountId, input.listingId, this.now().toISOString()],
    );
    if (result.rowCount !== 1) {
      throw new Error(
        `Cannot schedule margin reaudit for unconfigured listing ${input.accountId}/${input.listingId}.`,
      );
    }
  }

  async claim(input: {
    owner: string;
    now: string;
    leaseUntil: string;
    limit: number;
  }): Promise<readonly SupplierStockCandidate[]> {
    const result = await this.pool.query<{
      organizationId: string;
      accountId: string;
      listingId: string;
      recoveryStockThreshold: number;
      recoveryConsecutiveSyncs: number;
      costChangeAlertBps: number;
      policyVersion: string;
    }>(
      `WITH candidates AS (
         SELECT link.account_id, link.listing_id
         FROM supplier_listing_links link
         JOIN supplier_sources source
           ON source.organization_id = link.organization_id
          AND source.account_id = link.account_id
          AND source.id = link.supplier_source_id
         WHERE source.active = true
           AND link.stock_evidence_id IS NOT NULL
           AND link.next_evaluation_at <= $2
           AND (link.lease_until IS NULL OR link.lease_until <= $2)
         ORDER BY link.next_evaluation_at ASC, link.account_id ASC, link.listing_id ASC
         LIMIT $4
         FOR UPDATE OF link SKIP LOCKED
       )
       UPDATE supplier_listing_links link
       SET lease_owner = $1, lease_until = $3, updated_at = now()
       FROM candidates
       WHERE link.account_id = candidates.account_id
         AND link.listing_id = candidates.listing_id
       RETURNING link.organization_id AS "organizationId",
         link.account_id AS "accountId", link.listing_id AS "listingId",
         link.recovery_stock_threshold AS "recoveryStockThreshold",
         link.recovery_consecutive_syncs AS "recoveryConsecutiveSyncs",
         link.cost_change_alert_bps AS "costChangeAlertBps",
         link.policy_version AS "policyVersion"`,
      [input.owner, input.now, input.leaseUntil, input.limit],
    );
    return result.rows.map((row) =>
      Object.freeze({
        organizationId: row.organizationId,
        accountId: row.accountId,
        listingId: row.listingId,
        policy: Object.freeze({
          recoveryStockThreshold: row.recoveryStockThreshold,
          recoveryConsecutiveSyncs: row.recoveryConsecutiveSyncs,
          costChangeAlertBps: row.costChangeAlertBps,
          policyVersion: row.policyVersion,
        }),
      }),
    );
  }

  async complete(input: {
    candidate: SupplierStockCandidate;
    owner: string;
    nextEvaluationAt: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `UPDATE supplier_listing_links
       SET lease_owner = NULL, lease_until = NULL, next_evaluation_at = $5,
           last_error = NULL, updated_at = now()
       WHERE organization_id = $1 AND account_id = $2 AND listing_id = $3
         AND lease_owner = $4`,
      [
        input.candidate.organizationId,
        input.candidate.accountId,
        input.candidate.listingId,
        input.owner,
        input.nextEvaluationAt,
      ],
    );
    if (result.rowCount !== 1) throw new Error("Supplier stock lease was lost before completion.");
  }

  async fail(input: {
    candidate: SupplierStockCandidate;
    owner: string;
    retryAt: string;
    error: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `UPDATE supplier_listing_links
       SET lease_owner = NULL, lease_until = NULL, next_evaluation_at = $5,
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
    if (result.rowCount !== 1) throw new Error("Supplier stock lease was lost before retry release.");
  }
}

async function upsertProductCost(
  client: PoolClient,
  observation: SupplierMirrorObservation,
): Promise<void> {
  if (observation.unitCostMinor === null || !observation.costEvidence) return;
  await client.query(
    `INSERT INTO economic_cost_observations
      (organization_id, account_id, listing_id, cost_kind, amount_minor,
       evidence_id, evidence_source, observed_at, content_hash)
     VALUES ($1,$2,$3,'product-cost',$4,$5,$6,$7,$8)
     ON CONFLICT (account_id, listing_id, cost_kind) DO UPDATE SET
       organization_id = EXCLUDED.organization_id,
       amount_minor = EXCLUDED.amount_minor,
       evidence_id = EXCLUDED.evidence_id,
       evidence_source = EXCLUDED.evidence_source,
       observed_at = EXCLUDED.observed_at,
       content_hash = EXCLUDED.content_hash,
       updated_at = now()
     WHERE economic_cost_observations.observed_at <= EXCLUDED.observed_at`,
    [
      observation.organizationId,
      observation.accountId,
      observation.listingId,
      observation.unitCostMinor,
      observation.costEvidence.id,
      observation.costEvidence.source,
      observation.costEvidence.observedAt,
      observation.costEvidence.contentHash,
    ],
  );
}

async function scheduleEconomicAudit(
  client: PoolClient,
  accountId: string,
  listingId: string,
): Promise<void> {
  await client.query(
    `UPDATE economic_listing_policies
     SET next_audit_at = LEAST(next_audit_at, now()), updated_at = now()
     WHERE account_id = $1 AND listing_id = $2`,
    [accountId, listingId],
  );
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
