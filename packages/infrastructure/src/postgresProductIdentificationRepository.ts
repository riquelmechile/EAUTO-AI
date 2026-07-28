import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  ForReadingProductIdentificationReviews,
  ForReadingStoredProductIdentifications,
  ForSavingProductIdentificationResults,
  ForSavingProductIdentificationReviews,
  ForSearchingVisualDuplicates,
  ProductIdentificationArtifact,
  ProductVisionRequest,
} from "@eauto/application";
import type {
  ProductIdentificationResult,
  ProductIdentificationReview,
  ProductVisualFingerprint,
  StoredProductIdentification,
  VisualDuplicateCandidate,
} from "@eauto/domain";

export class PostgresProductIdentificationRepository
  implements
    ForSavingProductIdentificationResults,
    ForReadingStoredProductIdentifications,
    ForSavingProductIdentificationReviews,
    ForReadingProductIdentificationReviews,
    ForSearchingVisualDuplicates
{
  constructor(private readonly pool: Pool) {}

  async save(artifact: ProductIdentificationArtifact): Promise<void> {
    const inserted = await this.pool.query(
      `INSERT INTO product_identification_results
        (id, organization_id, account_id, source_image_upload_id, status,
         selected_candidate_id, policy_version, evaluated_at, content_hash,
         fingerprint_algorithm, fingerprint_version, fingerprint,
         fingerprint_evidence_ref, payload_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::bit(64),$13,$14::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [
        artifact.id,
        artifact.result.organizationId,
        artifact.result.accountId,
        artifact.result.sourceImageUploadId,
        artifact.result.status,
        artifact.result.selectedCandidate?.id ?? null,
        artifact.result.policyVersion,
        artifact.result.evaluatedAt,
        artifact.contentHash,
        artifact.fingerprint.algorithm,
        artifact.fingerprint.version,
        artifact.fingerprint.value,
        artifact.fingerprint.evidenceRef,
        JSON.stringify(artifact.result),
      ],
    );
    if (inserted.rowCount === 1) return;
    const existing = await this.get({
      organizationId: artifact.result.organizationId,
      accountId: artifact.result.accountId,
      identificationId: artifact.id,
    });
    if (!existing || existing.contentHash !== artifact.contentHash) {
      throw new Error("Product identification idempotency conflict.");
    }
  }

  async get(input: {
    organizationId: string;
    accountId: string;
    identificationId: string;
  }): Promise<StoredProductIdentification | null> {
    const result = await this.pool.query<{
      id: string;
      content_hash: string;
      payload_json: ProductIdentificationResult;
      fingerprint_algorithm: ProductVisualFingerprint["algorithm"];
      fingerprint_version: string;
      fingerprint: string;
      fingerprint_evidence_ref: string;
    }>(
      `SELECT id, content_hash, payload_json, fingerprint_algorithm,
         fingerprint_version, fingerprint::text, fingerprint_evidence_ref
       FROM product_identification_results
       WHERE organization_id = $1 AND account_id = $2 AND id = $3`,
      [input.organizationId, input.accountId, input.identificationId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return Object.freeze({
      id: row.id,
      contentHash: row.content_hash,
      result: freezeResult(row.payload_json),
      fingerprint: Object.freeze({
        algorithm: row.fingerprint_algorithm,
        version: row.fingerprint_version,
        value: row.fingerprint,
        evidenceRef: row.fingerprint_evidence_ref,
      }),
    });
  }

  async getReview(input: {
    organizationId: string;
    accountId: string;
    identificationId: string;
  }): Promise<ProductIdentificationReview | null> {
    const result = await this.pool.query<{ payload_json: ProductIdentificationReview }>(
      `SELECT payload_json
       FROM product_identification_reviews
       WHERE organization_id = $1 AND account_id = $2 AND identification_id = $3`,
      [input.organizationId, input.accountId, input.identificationId],
    );
    const review = result.rows[0]?.payload_json;
    return review
      ? Object.freeze({ ...review, evidenceRefs: Object.freeze([...review.evidenceRefs]) })
      : null;
  }

  async saveReview(
    review: ProductIdentificationReview,
    identification: StoredProductIdentification,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ content_hash: string }>(
        `SELECT content_hash FROM product_identification_results
         WHERE organization_id = $1 AND account_id = $2 AND id = $3
         FOR UPDATE`,
        [review.organizationId, review.accountId, review.identificationId],
      );
      if (locked.rows[0]?.content_hash !== identification.contentHash) {
        throw new Error("Product identification changed before review persistence.");
      }
      const inserted = await client.query(
        `INSERT INTO product_identification_reviews
          (id, organization_id, account_id, identification_id,
           source_image_upload_id, candidate_id, product_id, decision,
           reviewer_id, reason, policy_version, decided_at, payload_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
         ON CONFLICT (identification_id) DO NOTHING`,
        [
          review.id,
          review.organizationId,
          review.accountId,
          review.identificationId,
          review.sourceImageUploadId,
          review.candidateId,
          review.productId,
          review.decision,
          review.reviewerId,
          review.reason,
          review.policyVersion,
          review.decidedAt,
          JSON.stringify(review),
        ],
      );
      if (inserted.rowCount !== 1) {
        await this.assertExistingReview(client, review);
        await client.query("COMMIT");
        return;
      }
      if (review.decision === "confirmed") {
        await this.saveConfirmedFingerprint(client, review, identification.fingerprint);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async search(input: ProductVisionRequest): Promise<readonly VisualDuplicateCandidate[]> {
    const result = await this.pool.query<{
      product_id: string;
      similarity_bps: number;
      evidence_ref: string;
    }>(
      `SELECT product_id,
         (CASE
           WHEN algorithm = 'sha256-prefix-64' THEN
             CASE WHEN fingerprint = $5::bit(64) THEN 10000 ELSE 0 END
           ELSE ((((64 - bit_count(fingerprint # $5::bit(64))) * 10000) / 64))::int
         END)::int AS similarity_bps,
         evidence_ref
       FROM product_visual_fingerprints
       WHERE organization_id = $1 AND account_id = $2
         AND algorithm = $3 AND version = $4
       ORDER BY similarity_bps DESC, product_id ASC
       LIMIT 20`,
      [
        input.organizationId,
        input.accountId,
        input.fingerprint.algorithm,
        input.fingerprint.version,
        input.fingerprint.value,
      ],
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          productId: row.product_id,
          accountId: input.accountId,
          similarityBps: row.similarity_bps,
          evidenceRef: row.evidence_ref,
        }),
      ),
    );
  }

  private async assertExistingReview(
    client: PoolClient,
    review: ProductIdentificationReview,
  ): Promise<void> {
    const existing = await client.query<{ payload_json: ProductIdentificationReview }>(
      `SELECT payload_json FROM product_identification_reviews
       WHERE organization_id = $1 AND account_id = $2 AND identification_id = $3`,
      [review.organizationId, review.accountId, review.identificationId],
    );
    if (hashCanonical(existing.rows[0]?.payload_json) !== hashCanonical(review)) {
      throw new Error("Product identification review is already terminal with another decision.");
    }
  }

  private async saveConfirmedFingerprint(
    client: PoolClient,
    review: ProductIdentificationReview,
    fingerprint: ProductVisualFingerprint,
  ): Promise<void> {
    if (!review.productId) throw new Error("Confirmed review is missing productId.");
    const id = `product_visual_fingerprint_${hashCanonical({
      organizationId: review.organizationId,
      accountId: review.accountId,
      productId: review.productId,
      algorithm: fingerprint.algorithm,
      version: fingerprint.version,
    })}`;
    const inserted = await client.query(
      `INSERT INTO product_visual_fingerprints
        (id, organization_id, account_id, product_id, identification_id,
         source_image_upload_id, algorithm, version, fingerprint,
         evidence_ref, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::bit(64),$10,$11)
       ON CONFLICT (organization_id, account_id, product_id, algorithm, version) DO NOTHING`,
      [
        id,
        review.organizationId,
        review.accountId,
        review.productId,
        review.identificationId,
        review.sourceImageUploadId,
        fingerprint.algorithm,
        fingerprint.version,
        fingerprint.value,
        fingerprint.evidenceRef,
        review.decidedAt,
      ],
    );
    if (inserted.rowCount === 1) return;
    const existing = await client.query<{
      fingerprint: string;
      evidence_ref: string;
      identification_id: string;
    }>(
      `SELECT fingerprint::text, evidence_ref, identification_id
       FROM product_visual_fingerprints
       WHERE organization_id = $1 AND account_id = $2 AND product_id = $3
         AND algorithm = $4 AND version = $5`,
      [
        review.organizationId,
        review.accountId,
        review.productId,
        fingerprint.algorithm,
        fingerprint.version,
      ],
    );
    const row = existing.rows[0];
    if (
      row?.fingerprint !== fingerprint.value ||
      row.evidence_ref !== fingerprint.evidenceRef ||
      row.identification_id !== review.identificationId
    ) {
      throw new Error("Confirmed product already has a different product fingerprint.");
    }
  }
}

function freezeResult(result: ProductIdentificationResult): ProductIdentificationResult {
  return Object.freeze({
    ...result,
    selectedCandidate: result.selectedCandidate ? Object.freeze(result.selectedCandidate) : null,
    alternativeCandidates: Object.freeze(
      result.alternativeCandidates.map((candidate) => Object.freeze(candidate)),
    ),
    blockingDuplicate: result.blockingDuplicate ? Object.freeze(result.blockingDuplicate) : null,
    reasons: Object.freeze([...result.reasons]),
    evidenceRefs: Object.freeze([...result.evidenceRefs]),
  });
}

function hashCanonical(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}
