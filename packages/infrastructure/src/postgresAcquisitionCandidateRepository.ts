import type { Pool } from "pg";
import {
  CatalogAcquisitionConflictError,
  type AcquisitionCandidate,
  type AcquisitionCandidateStatus,
} from "@eauto/domain";
import type { AcquisitionCandidateRepository } from "@eauto/application";

export class PostgresAcquisitionCandidateRepository implements AcquisitionCandidateRepository {
  constructor(private readonly pool: Pool) {}

  async save(candidate: AcquisitionCandidate): Promise<void> {
    const inserted = await this.pool.query(
      `INSERT INTO catalog_acquisition_candidates
        (id, content_hash, organization_id, account_id, source_image_upload_id,
         visual_provider, external_match_id, similarity_bps, supplier_source_id,
         sku, product_name, product_url, unit_cost_minor, stock_quantity,
         currency_id, evidence_refs, policy_version, status,
         requires_human_approval, reviewed_at, reviewed_by, review_note,
         payload_json, created_at, updated_at)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
         $14, $15, $16::jsonb, $17, $18, $19, $20, $21, $22, $23::jsonb,
         $24, now())
       ON CONFLICT DO NOTHING`,
      candidateValues(candidate),
    );
    if (inserted.rowCount === 1) return;

    const existing = await this.pool.query<{ payload_json: AcquisitionCandidate }>(
      `SELECT payload_json
       FROM catalog_acquisition_candidates
       WHERE id = $1 OR content_hash = $2
       LIMIT 1`,
      [candidate.id, candidate.contentHash],
    );
    if (
      existing.rows[0] &&
      JSON.stringify(existing.rows[0].payload_json) === JSON.stringify(candidate)
    ) {
      return;
    }
    throw new CatalogAcquisitionConflictError(
      `Candidate ${candidate.id} already exists with different content.`,
    );
  }

  async get(input: {
    id: string;
    organizationId: string;
    accountId: string;
  }): Promise<AcquisitionCandidate | null> {
    const result = await this.pool.query<{ payload_json: AcquisitionCandidate }>(
      `SELECT payload_json
       FROM catalog_acquisition_candidates
       WHERE id = $1 AND organization_id = $2 AND account_id = $3`,
      [input.id, input.organizationId, input.accountId],
    );
    return result.rows[0]?.payload_json ?? null;
  }

  async list(input: {
    organizationId: string;
    accountId: string;
    status?: AcquisitionCandidateStatus;
    limit: number;
  }): Promise<readonly AcquisitionCandidate[]> {
    const result = await this.pool.query<{ payload_json: AcquisitionCandidate }>(
      `SELECT payload_json
       FROM catalog_acquisition_candidates
       WHERE organization_id = $1
         AND account_id = $2
         AND ($3::text IS NULL OR status = $3)
       ORDER BY created_at DESC, id DESC
       LIMIT $4`,
      [input.organizationId, input.accountId, input.status ?? null, input.limit],
    );
    return Object.freeze(result.rows.map((row) => row.payload_json));
  }

  async transition(input: {
    candidate: AcquisitionCandidate;
    expectedStatus: "needs-review";
  }): Promise<void> {
    const updated = await this.pool.query(
      `UPDATE catalog_acquisition_candidates
       SET status = $4,
           reviewed_at = $5,
           reviewed_by = $6,
           review_note = $7,
           payload_json = $8::jsonb
       WHERE id = $1
         AND organization_id = $2
         AND account_id = $3
         AND status = $9
         AND content_hash = $10`,
      [
        input.candidate.id,
        input.candidate.organizationId,
        input.candidate.accountId,
        input.candidate.status,
        input.candidate.reviewedAt,
        input.candidate.reviewedBy,
        input.candidate.reviewNote,
        JSON.stringify(input.candidate),
        input.expectedStatus,
        input.candidate.contentHash,
      ],
    );
    if (updated.rowCount !== 1) {
      throw new CatalogAcquisitionConflictError(
        `Candidate ${input.candidate.id} review transition conflicted.`,
      );
    }
  }
}

function candidateValues(candidate: AcquisitionCandidate): readonly unknown[] {
  return [
    candidate.id,
    candidate.contentHash,
    candidate.organizationId,
    candidate.accountId,
    candidate.sourceImageUploadId,
    candidate.visualProvider,
    candidate.externalMatchId,
    candidate.similarityBps,
    candidate.supplierSourceId,
    candidate.sku,
    candidate.name,
    candidate.productUrl,
    candidate.unitCostMinor,
    candidate.stockQuantity,
    candidate.currencyId,
    JSON.stringify(candidate.evidenceRefs),
    candidate.policyVersion,
    candidate.status,
    candidate.requiresHumanApproval,
    candidate.reviewedAt,
    candidate.reviewedBy,
    candidate.reviewNote,
    JSON.stringify(candidate),
    candidate.createdAt,
  ];
}
