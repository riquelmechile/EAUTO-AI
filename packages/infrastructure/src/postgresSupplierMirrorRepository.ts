import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  MercadoLibreListingSnapshot,
  RecordedSupplierProduct,
  StockAvailabilityProposal,
  StockSourceType,
  SupplierProductObservation,
  SupplierStockAssessment,
  SupplierStockInput,
} from "@eauto/domain";
import type {
  ForLeasingSupplierStockCandidates,
  ForReadingSupplierStockInputs,
  ForRecordingSupplierProductObservations,
  ForSavingStockAvailabilityProposals,
  ForSavingSupplierStockAssessments,
  ForSchedulingMarginReaudits,
  SupplierStockAuditCandidate,
} from "@eauto/application";

type SupplierProductRow = {
  organization_id: string;
  account_id: string;
  supplier_source_id: string;
  source_type: StockSourceType;
  sku: string;
  name: string;
  previous_stock_qty: string;
  stock_qty: string;
  previous_unit_cost_minor: string | null;
  unit_cost_minor: string | null;
  sync_succeeded: boolean;
  consecutive_successful_syncs: number;
  observed_at: Date | string;
  evidence_id: string;
  evidence_source: string;
  evidence_content_hash: string;
};

export class PostgresSupplierMirrorRepository
  implements
    ForRecordingSupplierProductObservations,
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

  async record(observation: SupplierProductObservation): Promise<
    Readonly<{
      recorded: boolean;
      product: RecordedSupplierProduct;
    }>
  > {
    const client = await this.pool.connect();
    const contentHash = hashCanonical(observation);
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `${observation.supplierSourceId}:${observation.sku}`,
      ]);
      const source = await client.query<{ source_type: StockSourceType }>(
        `SELECT source_type FROM supplier_sources
         WHERE organization_id = $1 AND account_id = $2 AND id = $3 AND active = true
         FOR UPDATE`,
        [observation.organizationId, observation.accountId, observation.supplierSourceId],
      );
      const sourceType = source.rows[0]?.source_type;
      if (!sourceType) throw new Error("Supplier source was not found in the requested scope.");
      if (sourceType !== observation.sourceType) {
        throw new Error("Supplier observation source type does not match the configured source.");
      }

      const inserted = await client.query(
        `INSERT INTO supplier_product_observations
          (id, organization_id, account_id, supplier_source_id, sku, observed_at,
           content_hash, payload_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (supplier_source_id, sku, content_hash) DO NOTHING`,
        [
          `supplier_observation_${contentHash}`,
          observation.organizationId,
          observation.accountId,
          observation.supplierSourceId,
          observation.sku,
          observation.observedAt,
          contentHash,
          JSON.stringify(observation),
        ],
      );
      if (inserted.rowCount !== 1) {
        const existing = await this.getProduct(
          client,
          observation.accountId,
          observation.supplierSourceId,
          observation.sku,
        );
        if (!existing)
          throw new Error("Supplier observation exists without current product state.");
        await client.query("COMMIT");
        return Object.freeze({ recorded: false, product: mapRecordedProduct(existing) });
      }

      const previous = await this.getProduct(
        client,
        observation.accountId,
        observation.supplierSourceId,
        observation.sku,
        true,
      );
      const previousStock = previous
        ? toSafeInteger(previous.stock_qty, "previousStock")
        : observation.stockQuantity;
      const previousUnitCostMinor = previous
        ? toNullableSafeInteger(previous.unit_cost_minor, "previousUnitCostMinor")
        : observation.unitCostMinor;
      const consecutiveSuccessfulSyncs = observation.syncSucceeded
        ? previous?.sync_succeeded
          ? previous.consecutive_successful_syncs + 1
          : 1
        : 0;

      await client.query(
        `INSERT INTO supplier_products
          (organization_id, account_id, supplier_source_id, sku, name,
           previous_stock_qty, stock_qty, previous_unit_cost_minor, unit_cost_minor,
           sync_succeeded, consecutive_successful_syncs, observed_at, evidence_id,
           evidence_source, evidence_content_hash, current_content_hash, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now())
         ON CONFLICT (supplier_source_id, sku) DO UPDATE SET
           name = EXCLUDED.name,
           previous_stock_qty = EXCLUDED.previous_stock_qty,
           stock_qty = EXCLUDED.stock_qty,
           previous_unit_cost_minor = EXCLUDED.previous_unit_cost_minor,
           unit_cost_minor = EXCLUDED.unit_cost_minor,
           sync_succeeded = EXCLUDED.sync_succeeded,
           consecutive_successful_syncs = EXCLUDED.consecutive_successful_syncs,
           observed_at = EXCLUDED.observed_at,
           evidence_id = EXCLUDED.evidence_id,
           evidence_source = EXCLUDED.evidence_source,
           evidence_content_hash = EXCLUDED.evidence_content_hash,
           current_content_hash = EXCLUDED.current_content_hash,
           updated_at = now()`,
        [
          observation.organizationId,
          observation.accountId,
          observation.supplierSourceId,
          observation.sku,
          observation.name,
          previousStock,
          observation.stockQuantity,
          previousUnitCostMinor,
          observation.unitCostMinor,
          observation.syncSucceeded,
          consecutiveSuccessfulSyncs,
          observation.observedAt,
          observation.evidence.id,
          observation.evidence.source,
          observation.evidence.contentHash,
          contentHash,
        ],
      );
      await client.query(
        `UPDATE supplier_listing_links
         SET next_audit_at = LEAST(next_audit_at, now()), updated_at = now()
         WHERE organization_id = $1 AND account_id = $2
           AND supplier_source_id = $3 AND sku = $4 AND active = true`,
        [
          observation.organizationId,
          observation.accountId,
          observation.supplierSourceId,
          observation.sku,
        ],
      );
      const product = await this.getProduct(
        client,
        observation.accountId,
        observation.supplierSourceId,
        observation.sku,
      );
      if (!product) throw new Error("Supplier product state was not persisted.");
      await client.query("COMMIT");
      return Object.freeze({ recorded: true, product: mapRecordedProduct(product) });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async read(
    accountId: string,
    listingId: string,
    supplierSourceId: string,
  ): Promise<SupplierStockInput> {
    const result = await this.pool.query<{
      organization_id: string;
      source_type: StockSourceType;
      sku: string;
      previous_stock_qty: string;
      stock_qty: string;
      previous_unit_cost_minor: string | null;
      unit_cost_minor: string | null;
      sync_succeeded: boolean;
      consecutive_successful_syncs: number;
      observed_at: Date | string;
      evidence_id: string;
      evidence_source: string;
      evidence_content_hash: string;
      maximum_evidence_age_ms: string;
      listing_payload: MercadoLibreListingSnapshot;
      profitability_status: SupplierStockInput["profitabilityStatus"] | null;
    }>(
      `SELECT link.organization_id, source.source_type, link.sku,
         product.previous_stock_qty::text, product.stock_qty::text,
         product.previous_unit_cost_minor::text, product.unit_cost_minor::text,
         product.sync_succeeded, product.consecutive_successful_syncs,
         product.observed_at, product.evidence_id, product.evidence_source,
         product.evidence_content_hash, link.maximum_evidence_age_ms::text,
         listing.payload_json AS listing_payload,
         profitability.status AS profitability_status
       FROM supplier_listing_links link
       JOIN supplier_sources source
         ON source.organization_id = link.organization_id
        AND source.account_id = link.account_id
        AND source.id = link.supplier_source_id
        AND source.active = true
       JOIN supplier_products product
         ON product.organization_id = link.organization_id
        AND product.account_id = link.account_id
        AND product.supplier_source_id = link.supplier_source_id
        AND product.sku = link.sku
       JOIN mercadolibre_listing_snapshots listing
         ON listing.account_id = link.account_id AND listing.item_id = link.listing_id
       LEFT JOIN LATERAL (
         SELECT snapshot.status
         FROM profitability_snapshots snapshot
         WHERE snapshot.account_id = link.account_id
           AND snapshot.listing_id = link.listing_id
         ORDER BY snapshot.calculated_at DESC, snapshot.id DESC
         LIMIT 1
       ) profitability ON true
       WHERE link.account_id = $1 AND link.listing_id = $2
         AND link.supplier_source_id = $3 AND link.active = true
       LIMIT 1`,
      [accountId, listingId, supplierSourceId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Supplier listing link was not found in the requested scope.");
    const listing = row.listing_payload;
    if (listing.accountId !== accountId || listing.itemId !== listingId) {
      throw new Error("MercadoLibre listing snapshot is outside the supplier link scope.");
    }
    if (listing.status !== "active" && listing.status !== "paused") {
      throw new Error(
        `MercadoLibre listing status ${listing.status} is not eligible for stock audit.`,
      );
    }
    const evidence = Object.freeze({
      id: row.evidence_id,
      source: row.evidence_source,
      observedAt: toIso(row.observed_at),
      contentHash: row.evidence_content_hash,
    });
    const currentUnitCostMinor = toNullableSafeInteger(row.unit_cost_minor, "currentUnitCostMinor");

    return Object.freeze({
      organizationId: row.organization_id,
      accountId,
      listingId,
      supplierSourceId,
      sourceType: row.source_type,
      previousStock: toSafeInteger(row.previous_stock_qty, "previousStock"),
      currentStock: toSafeInteger(row.stock_qty, "currentStock"),
      consecutiveSuccessfulSyncs: row.consecutive_successful_syncs,
      syncSucceeded: row.sync_succeeded,
      listingStatus: listing.status,
      previousUnitCostMinor: toNullableSafeInteger(
        row.previous_unit_cost_minor,
        "previousUnitCostMinor",
      ),
      currentUnitCostMinor,
      profitabilityStatus: row.profitability_status ?? "unknown",
      stockEvidence: evidence,
      costEvidence: currentUnitCostMinor === null ? null : evidence,
      asOf: this.now().toISOString(),
      maximumEvidenceAgeMs: toSafeInteger(row.maximum_evidence_age_ms, "maximumEvidenceAgeMs"),
    });
  }

  async save(value: SupplierStockAssessment): Promise<void>;
  async save(value: StockAvailabilityProposal): Promise<void>;
  async save(value: SupplierStockAssessment | StockAvailabilityProposal): Promise<void> {
    if ("kind" in value) {
      await this.persistProposal(value);
      return;
    }
    await this.persistAssessment(value);
  }

  async schedule(
    input: Readonly<{
      organizationId: string;
      accountId: string;
      listingId: string;
      reason: string;
      evidenceRefs: readonly string[];
    }>,
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE economic_listing_policies
       SET next_audit_at = LEAST(next_audit_at, now()), updated_at = now()
       WHERE account_id = $1 AND listing_id = $2
         AND organization_id = $3`,
      [input.accountId, input.listingId, input.organizationId],
    );
    if (result.rowCount !== 1) {
      throw new Error(`Economic policy is missing for margin reaudit: ${input.reason}.`);
    }
  }

  async claim(input: {
    owner: string;
    now: string;
    leaseUntil: string;
    limit: number;
  }): Promise<readonly SupplierStockAuditCandidate[]> {
    const result = await this.pool.query<{
      organization_id: string;
      account_id: string;
      listing_id: string;
      supplier_source_id: string;
      recovery_stock_threshold: string;
      recovery_consecutive_syncs: number;
      cost_change_alert_bps: number;
      policy_version: string;
    }>(
      `WITH candidates AS (
         SELECT link.account_id, link.listing_id, link.supplier_source_id
         FROM supplier_listing_links link
         JOIN supplier_sources source
           ON source.organization_id = link.organization_id
          AND source.account_id = link.account_id
          AND source.id = link.supplier_source_id
          AND source.active = true
         WHERE link.active = true AND link.next_audit_at <= $2
           AND (link.lease_until IS NULL OR link.lease_until <= $2)
         ORDER BY link.next_audit_at ASC, link.account_id ASC, link.listing_id ASC
         LIMIT $4
         FOR UPDATE OF link SKIP LOCKED
       )
       UPDATE supplier_listing_links link
       SET lease_owner = $1, lease_until = $3, updated_at = now()
       FROM candidates
       WHERE link.account_id = candidates.account_id
         AND link.listing_id = candidates.listing_id
         AND link.supplier_source_id = candidates.supplier_source_id
       RETURNING link.organization_id, link.account_id, link.listing_id,
         link.supplier_source_id, link.recovery_stock_threshold::text,
         link.recovery_consecutive_syncs, link.cost_change_alert_bps,
         link.policy_version`,
      [input.owner, input.now, input.leaseUntil, input.limit],
    );
    return result.rows.map((row) =>
      Object.freeze({
        organizationId: row.organization_id,
        accountId: row.account_id,
        listingId: row.listing_id,
        supplierSourceId: row.supplier_source_id,
        policy: Object.freeze({
          recoveryStockThreshold: toSafeInteger(
            row.recovery_stock_threshold,
            "recoveryStockThreshold",
          ),
          recoveryConsecutiveSyncs: row.recovery_consecutive_syncs,
          costChangeAlertBps: row.cost_change_alert_bps,
          policyVersion: row.policy_version,
        }),
      }),
    );
  }

  async complete(input: {
    candidate: SupplierStockAuditCandidate;
    owner: string;
    nextAuditAt: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `UPDATE supplier_listing_links
       SET lease_owner = NULL, lease_until = NULL, next_audit_at = $5,
           last_error = NULL, updated_at = now()
       WHERE organization_id = $1 AND account_id = $2 AND listing_id = $3
         AND supplier_source_id = $4 AND lease_owner = $6`,
      [
        input.candidate.organizationId,
        input.candidate.accountId,
        input.candidate.listingId,
        input.candidate.supplierSourceId,
        input.nextAuditAt,
        input.owner,
      ],
    );
    if (result.rowCount !== 1) throw new Error("Supplier stock audit lease was lost.");
  }

  async fail(input: {
    candidate: SupplierStockAuditCandidate;
    owner: string;
    retryAt: string;
    error: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `UPDATE supplier_listing_links
       SET lease_owner = NULL, lease_until = NULL, next_audit_at = $5,
           last_error = $6, updated_at = now()
       WHERE organization_id = $1 AND account_id = $2 AND listing_id = $3
         AND supplier_source_id = $4 AND lease_owner = $7`,
      [
        input.candidate.organizationId,
        input.candidate.accountId,
        input.candidate.listingId,
        input.candidate.supplierSourceId,
        input.retryAt,
        input.error,
        input.owner,
      ],
    );
    if (result.rowCount !== 1) throw new Error("Supplier stock audit lease was lost.");
  }

  private async persistAssessment(assessment: SupplierStockAssessment): Promise<void> {
    const contentHash = hashCanonical({
      organizationId: assessment.organizationId,
      accountId: assessment.accountId,
      listingId: assessment.listingId,
      supplierSourceId: assessment.supplierSourceId,
      sourceType: assessment.sourceType,
      stockDelta: assessment.stockDelta,
      evidenceRefs: assessment.evidenceRefs,
      availabilityProposal: assessment.availabilityProposal,
      signals: assessment.signals,
    });
    await this.pool.query(
      `INSERT INTO supplier_stock_assessments
        (id, organization_id, account_id, supplier_source_id, listing_id,
         evaluated_at, content_hash, payload_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (content_hash) DO NOTHING`,
      [
        `supplier_assessment_${contentHash}`,
        assessment.organizationId,
        assessment.accountId,
        assessment.supplierSourceId,
        assessment.listingId,
        assessment.evaluatedAt,
        contentHash,
        JSON.stringify(assessment),
      ],
    );
  }

  private async persistProposal(proposal: StockAvailabilityProposal): Promise<void> {
    const contentHash = hashCanonical(proposal);
    await this.pool.query(
      `INSERT INTO supplier_availability_proposals
        (id, organization_id, account_id, supplier_source_id, listing_id,
         proposal_kind, policy_version, content_hash, payload_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       ON CONFLICT (content_hash) DO NOTHING`,
      [
        `supplier_proposal_${contentHash}`,
        proposal.organizationId,
        proposal.accountId,
        proposal.supplierSourceId,
        proposal.listingId,
        proposal.kind,
        proposal.policyVersion,
        contentHash,
        JSON.stringify(proposal),
      ],
    );
  }

  private async getProduct(
    client: PoolClient,
    accountId: string,
    supplierSourceId: string,
    sku: string,
    forUpdate = false,
  ): Promise<SupplierProductRow | null> {
    const result = await client.query<SupplierProductRow>(
      `SELECT product.organization_id, product.account_id, product.supplier_source_id,
         source.source_type, product.sku, product.name,
         product.previous_stock_qty::text, product.stock_qty::text,
         product.previous_unit_cost_minor::text, product.unit_cost_minor::text,
         product.sync_succeeded, product.consecutive_successful_syncs,
         product.observed_at, product.evidence_id, product.evidence_source,
         product.evidence_content_hash
       FROM supplier_products product
       JOIN supplier_sources source
         ON source.organization_id = product.organization_id
        AND source.account_id = product.account_id
        AND source.id = product.supplier_source_id
       WHERE product.account_id = $1 AND product.supplier_source_id = $2
         AND product.sku = $3
       ${forUpdate ? "FOR UPDATE OF product" : ""}`,
      [accountId, supplierSourceId, sku],
    );
    return result.rows[0] ?? null;
  }
}

function mapRecordedProduct(row: SupplierProductRow): RecordedSupplierProduct {
  const evidence = Object.freeze({
    id: row.evidence_id,
    source: row.evidence_source,
    observedAt: toIso(row.observed_at),
    contentHash: row.evidence_content_hash,
  });
  return Object.freeze({
    organizationId: row.organization_id,
    accountId: row.account_id,
    supplierSourceId: row.supplier_source_id,
    sourceType: row.source_type,
    sku: row.sku,
    name: row.name,
    previousStock: toSafeInteger(row.previous_stock_qty, "previousStock"),
    currentStock: toSafeInteger(row.stock_qty, "currentStock"),
    previousUnitCostMinor: toNullableSafeInteger(
      row.previous_unit_cost_minor,
      "previousUnitCostMinor",
    ),
    currentUnitCostMinor: toNullableSafeInteger(row.unit_cost_minor, "currentUnitCostMinor"),
    consecutiveSuccessfulSyncs: row.consecutive_successful_syncs,
    syncSucceeded: row.sync_succeeded,
    observedAt: toIso(row.observed_at),
    evidence,
  });
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

function toNullableSafeInteger(value: string | null, field: string): number | null {
  return value === null ? null : toSafeInteger(value, field);
}
