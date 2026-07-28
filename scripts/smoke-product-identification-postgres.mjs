import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  ProductIdentificationReviewService,
  ProductIdentificationService,
} from "@eauto/application";
import { DeterministicProductVisionProvider } from "@eauto/content";
import { calculateVisualSimilarityBps } from "@eauto/domain";
import {
  PostgresProductIdentificationRepository,
  PostgresSourceImageUploadRepository,
} from "@eauto/infrastructure";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for product identification smoke.");

const pool = new Pool({ connectionString: databaseUrl });
const suffix = randomUUID().replaceAll("-", "");
const organizationId = `identification-org-${suffix}`;
const accountId = `identification-account-${suffix}`;
const uploadId = `identification-upload-${suffix}`;
const checksum = `${"A".repeat(43)}=`;
const evidenceId = `source-image:${uploadId}:${checksum}`;
const evaluatedAt = "2026-07-27T13:00:00.000Z";

try {
  await pool.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
    organizationId,
    "Product identification smoke organization",
  ]);
  await pool.query(
    `INSERT INTO commerce_accounts
      (id, organization_id, name, channel, market, minimum_margin_bps, autonomy_level)
     VALUES ($1,$2,$3,'mercadolibre','MLC',3000,'ask')`,
    [accountId, organizationId, "Product identification smoke account"],
  );

  const upload = Object.freeze({
    id: uploadId,
    organizationId,
    accountId,
    objectKey: `organizations/${organizationId}/accounts/${accountId}/source-images/${uploadId}.jpg`,
    originalFileName: "product.jpg",
    contentType: "image/jpeg",
    sizeBytes: 1_024,
    checksumSha256Base64: checksum,
    status: "verified",
    objectUri: `s3://eauto-content/organizations/${organizationId}/accounts/${accountId}/${uploadId}.jpg`,
    createdAt: "2026-07-27T11:50:00.000Z",
    expiresAt: "2026-07-27T12:50:00.000Z",
    verifiedAt: "2026-07-27T12:00:00.000Z",
    rejectionReason: null,
  });
  await pool.query(
    `INSERT INTO source_image_uploads
      (id, organization_id, account_id, object_key, status, expires_at, payload_json)
     VALUES ($1,$2,$3,$4,'verified',$5,$6::jsonb)`,
    [
      upload.id,
      organizationId,
      accountId,
      upload.objectKey,
      upload.expiresAt,
      JSON.stringify(upload),
    ],
  );

  const provider = new DeterministicProductVisionProvider([
    {
      contentHash: checksum,
      candidates: [
        {
          id: "candidate-shears",
          canonicalName: "Esquiladora inalámbrica para ovejas",
          brand: null,
          model: null,
          categoryHint: "Herramientas para animales",
          confidenceBps: 9_600,
        },
      ],
      duplicates: [],
    },
  ]);
  const repository = new PostgresProductIdentificationRepository(pool);
  const service = new ProductIdentificationService(
    new PostgresSourceImageUploadRepository(pool),
    provider,
    provider,
    repository,
    repository,
    () => new Date(evaluatedAt),
  );
  const policy = Object.freeze({
    minimumConfidenceBps: 8_500,
    minimumLeadBps: 1_000,
    duplicateThresholdBps: 9_500,
    maximumEvidenceAgeMs: 86_400_000,
    policyVersion: "product-identification-v1",
  });

  const first = await service.identifyFromPhoto({
    organizationId,
    accountId,
    sourceImageUploadId: uploadId,
    policy,
  });
  const second = await service.identifyFromPhoto({
    organizationId,
    accountId,
    sourceImageUploadId: uploadId,
    policy,
  });
  assert(
    first.status === "identified-pending-confirmation",
    "clear product must await confirmation",
  );
  assert(
    JSON.stringify(first) === JSON.stringify(second),
    "identical evaluation must be deterministic",
  );

  const resultRows = await pool.query(
    `SELECT id FROM product_identification_results
     WHERE organization_id = $1 AND account_id = $2 AND source_image_upload_id = $3`,
    [organizationId, accountId, uploadId],
  );
  assert(resultRows.rowCount === 1, "identical product identification must persist once");
  const identificationId = resultRows.rows[0]?.id;
  if (!identificationId) throw new Error("Persisted product identification id is missing.");
  const stored = await repository.get({ organizationId, accountId, identificationId });
  if (!stored) throw new Error("Persisted product identification could not be read.");
  assert(stored.result.selectedCandidate?.id === "candidate-shears", "selected candidate was lost");

  const reviewService = new ProductIdentificationReviewService(repository, repository);
  const reviewInput = Object.freeze({
    reviewId: `identification-review-${suffix}`,
    organizationId,
    accountId,
    identificationId,
    candidateId: "candidate-shears",
    productId: `catalog-product-${suffix}`,
    decision: "confirmed",
    reviewerId: "production-smoke-reviewer",
    reason: null,
    decidedAt: "2026-07-27T13:10:00.000Z",
  });
  await reviewService.review(reviewInput);
  await reviewService.review(reviewInput);

  const reviewCount = await pool.query(
    `SELECT count(*)::int AS count FROM product_identification_reviews
     WHERE organization_id = $1 AND account_id = $2 AND identification_id = $3`,
    [organizationId, accountId, identificationId],
  );
  assert(reviewCount.rows[0]?.count === 1, "identical review must persist once");
  const fingerprintCount = await pool.query(
    `SELECT count(*)::int AS count FROM product_visual_fingerprints
     WHERE organization_id = $1 AND account_id = $2 AND identification_id = $3`,
    [organizationId, accountId, identificationId],
  );
  assert(fingerprintCount.rows[0]?.count === 1, "confirmed review must index one fingerprint");

  const duplicates = await repository.search({
    organizationId,
    accountId,
    sourceImageUploadId: uploadId,
    objectUri: upload.objectUri,
    contentHash: checksum,
    evidenceId,
    fingerprint: stored.fingerprint,
  });
  assert(
    duplicates[0]?.productId === reviewInput.productId,
    "confirmed product was not searchable",
  );
  assert(duplicates[0]?.similarityBps === 10_000, "identical fingerprint must score 10000 bps");

  const oneBitDifferent = Object.freeze({
    ...stored.fingerprint,
    value: `${stored.fingerprint.value[0] === "0" ? "1" : "0"}${stored.fingerprint.value.slice(1)}`,
  });
  const nearDuplicates = await repository.search({
    organizationId,
    accountId,
    sourceImageUploadId: uploadId,
    objectUri: upload.objectUri,
    contentHash: checksum,
    evidenceId,
    fingerprint: oneBitDifferent,
  });
  assert(
    nearDuplicates[0]?.similarityBps ===
      calculateVisualSimilarityBps(stored.fingerprint.value, oneBitDifferent.value),
    "PostgreSQL and domain visual similarity must use the same basis-point rounding",
  );

  await reviewService
    .review({
      ...reviewInput,
      reviewId: `conflicting-review-${suffix}`,
      decision: "rejected",
      productId: null,
      reason: "Conflicting terminal decision",
    })
    .then(() => {
      throw new Error("Conflicting review unexpectedly succeeded.");
    })
    .catch((error) => {
      if (!String(error).includes("already terminal")) throw error;
    });

  console.log("✓ Product identification persistence, review and visual similarity verified");
} finally {
  await pool
    .query(
      `DELETE FROM product_visual_fingerprints
       WHERE organization_id = $1 AND account_id = $2`,
      [organizationId, accountId],
    )
    .catch(() => undefined);
  await pool
    .query(
      `DELETE FROM product_identification_reviews
       WHERE organization_id = $1 AND account_id = $2`,
      [organizationId, accountId],
    )
    .catch(() => undefined);
  await pool
    .query(
      `DELETE FROM product_identification_results
       WHERE organization_id = $1 AND account_id = $2`,
      [organizationId, accountId],
    )
    .catch(() => undefined);
  await pool
    .query(
      `DELETE FROM source_image_uploads
       WHERE organization_id = $1 AND account_id = $2`,
      [organizationId, accountId],
    )
    .catch(() => undefined);
  await pool
    .query(`DELETE FROM commerce_accounts WHERE organization_id = $1 AND id = $2`, [
      organizationId,
      accountId,
    ])
    .catch(() => undefined);
  await pool
    .query(`DELETE FROM organizations WHERE id = $1`, [organizationId])
    .catch(() => undefined);
  await pool.end();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
