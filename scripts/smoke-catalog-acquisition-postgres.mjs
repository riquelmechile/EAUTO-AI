import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Pool } from "pg";
import { reviewAcquisitionCandidate } from "@eauto/domain";
import { PostgresAcquisitionCandidateRepository } from "@eauto/infrastructure";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for the catalog acquisition smoke.");

const pool = new Pool({ connectionString: databaseUrl });
const suffix = randomUUID().replaceAll("-", "");
const organizationId = `catalog-org-${suffix}`;
const accountId = `catalog-account-${suffix}`;
const otherAccountId = `catalog-other-${suffix}`;
const sourceImageUploadId = `catalog-upload-${suffix}`;
const supplierSourceId = `catalog-supplier-${suffix}`;
const candidateId = `acquisition-${suffix.slice(0, 32)}`;
const createdAt = "2026-07-28T15:00:00.000Z";
const repository = new PostgresAcquisitionCandidateRepository(pool);
const candidate = Object.freeze({
  id: candidateId,
  contentHash: "a".repeat(64),
  organizationId,
  accountId,
  sourceImageUploadId,
  visualProvider: "catalog-smoke-visual",
  externalMatchId: `match-${suffix}`,
  similarityBps: 9_100,
  supplierSourceId,
  sku: `SKU-${suffix.slice(0, 12)}`,
  name: "Catalog acquisition smoke product",
  productUrl: "https://supplier.example/catalog/smoke-product",
  unitCostMinor: 12_500,
  stockQuantity: 17,
  currencyId: "CLP",
  evidenceRefs: Object.freeze([`visual-${suffix}`, `catalog-${suffix}`]),
  policyVersion: "catalog-acquisition-smoke-v1",
  status: "needs-review",
  requiresHumanApproval: true,
  createdAt,
  reviewedAt: null,
  reviewedBy: null,
  reviewNote: null,
});

try {
  await seedScope();
  const inserted = await repository.save(candidate);
  const repeated = await repository.save(candidate);
  assert(isDeepStrictEqual(inserted, candidate), "inserted candidate must be canonical");
  assert(isDeepStrictEqual(repeated, candidate), "identical save must return canonical candidate");

  const loaded = await repository.get({ id: candidate.id, organizationId, accountId });
  assert(isDeepStrictEqual(loaded, candidate), "saved candidate must round-trip structurally");
  const crossScope = await repository.get({
    id: candidate.id,
    organizationId,
    accountId: otherAccountId,
  });
  assert(crossScope === null, "cross-account candidate reads must be hidden");

  const pending = await repository.list({
    organizationId,
    accountId,
    status: "needs-review",
    limit: 10,
  });
  assert(pending.length === 1, "one pending candidate must be listed");

  const reviewed = reviewAcquisitionCandidate(candidate, {
    decision: "accepted",
    reviewedBy: "catalog-smoke-reviewer",
    reviewedAt: "2026-07-28T15:05:00.000Z",
    note: "Evidence confirmed by smoke test.",
  });
  await repository.transition({ candidate: reviewed, expectedStatus: "needs-review" });
  const accepted = await repository.list({
    organizationId,
    accountId,
    status: "accepted",
    limit: 10,
  });
  assert(accepted.length === 1, "reviewed candidate must be listed as accepted");
  assert(
    accepted[0]?.reviewedBy === "catalog-smoke-reviewer",
    "review identity must persist durably",
  );

  const rediscovered = await repository.save({
    ...candidate,
    createdAt: "2026-07-28T16:00:00.000Z",
  });
  assert(
    isDeepStrictEqual(rediscovered, reviewed),
    "rediscovery must return the reviewed canonical candidate",
  );

  await assertRejects(
    repository.transition({ candidate: reviewed, expectedStatus: "needs-review" }),
    /transition conflicted/,
    "a repeated review must fail compare-and-set",
  );

  const indexed = await pool.query(
    `SELECT status, reviewed_by, review_note, payload_json
     FROM catalog_acquisition_candidates
     WHERE id = $1`,
    [candidate.id],
  );
  assert(indexed.rows[0]?.status === "accepted", "indexed status must match payload status");
  assert(
    indexed.rows[0]?.payload_json?.status === "accepted",
    "payload lifecycle must match indexed lifecycle",
  );
  assert(
    indexed.rows[0]?.review_note === "Evidence confirmed by smoke test.",
    "review note must persist",
  );

  console.log(
    "✓ Catalog acquisition persistence, lifecycle-safe idempotency, scope isolation and review CAS verified",
  );
} finally {
  await cleanup();
  await pool.end();
}

async function seedScope() {
  await pool.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
    organizationId,
    "Catalog Acquisition Smoke",
  ]);
  for (const id of [accountId, otherAccountId]) {
    await pool.query(
      `INSERT INTO commerce_accounts
        (id, organization_id, name, channel, market, minimum_margin_bps, autonomy_level)
       VALUES ($1, $2, $3, 'mercadolibre', 'MLC', 3000, 'ask')`,
      [id, organizationId, id],
    );
  }
  await pool.query(
    `INSERT INTO supplier_sources
      (id, organization_id, account_id, name, source_type, active)
     VALUES ($1, $2, $3, $4, 'online', true)`,
    [supplierSourceId, organizationId, accountId, "Catalog Smoke Supplier"],
  );
  const upload = Object.freeze({
    id: sourceImageUploadId,
    organizationId,
    accountId,
    objectKey: `organizations/${organizationId}/accounts/${accountId}/source-images/${sourceImageUploadId}.jpg`,
    originalFileName: "catalog-smoke.jpg",
    contentType: "image/jpeg",
    sizeBytes: 1_024,
    checksumSha256Base64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    status: "verified",
    objectUri: `s3://catalog-smoke/${sourceImageUploadId}.jpg`,
    createdAt,
    expiresAt: "2026-07-28T16:00:00.000Z",
    verifiedAt: "2026-07-28T15:01:00.000Z",
    rejectionReason: null,
  });
  await pool.query(
    `INSERT INTO source_image_uploads
      (id, organization_id, account_id, object_key, status, expires_at, payload_json)
     VALUES ($1, $2, $3, $4, 'verified', $5, $6::jsonb)`,
    [
      upload.id,
      upload.organizationId,
      upload.accountId,
      upload.objectKey,
      upload.expiresAt,
      JSON.stringify(upload),
    ],
  );
}

async function cleanup() {
  await pool
    .query(`DELETE FROM catalog_acquisition_candidates WHERE organization_id = $1`, [
      organizationId,
    ])
    .catch(() => undefined);
  await pool
    .query(`DELETE FROM source_image_uploads WHERE organization_id = $1`, [organizationId])
    .catch(() => undefined);
  await pool
    .query(`DELETE FROM supplier_sources WHERE organization_id = $1`, [organizationId])
    .catch(() => undefined);
  await pool
    .query(`DELETE FROM commerce_accounts WHERE organization_id = $1`, [organizationId])
    .catch(() => undefined);
  await pool
    .query(`DELETE FROM organizations WHERE id = $1`, [organizationId])
    .catch(() => undefined);
}

async function assertRejects(promise, pattern, message) {
  try {
    await promise;
  } catch (error) {
    const rendered = error instanceof Error ? error.message : String(error);
    assert(pattern.test(rendered), `${message}: unexpected error ${rendered}`);
    return;
  }
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
