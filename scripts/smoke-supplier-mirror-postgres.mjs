import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  ProfitEngineService,
  SupplierMirrorService,
  SupplierStockAuditDaemon,
  SupplierStockService,
} from "@eauto/application";
import {
  PostgresProfitEngineRepository,
  PostgresSupplierMirrorRepository,
} from "@eauto/infrastructure";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for the supplier-mirror smoke.");

const pool = new Pool({ connectionString: databaseUrl });
const suffix = randomUUID().replaceAll("-", "");
const organizationId = `supplier-org-${suffix}`;
const accountId = `supplier-account-${suffix}`;
const supplierSourceId = `supplier-source-${suffix}`;
const sku = `SKU-${suffix.slice(0, 12)}`;
const listingId = `MLC${suffix.slice(0, 12)}`;
const sellerId = `seller-${suffix}`;
const productCostEvidenceId = `supplier-product-cost-${suffix}`;
const fulfillmentCostEvidenceId = `supplier-fulfillment-cost-${suffix}`;
const firstObservedAt = "2026-07-27T12:00:00.000Z";
const firstRecoveryObservedAt = "2026-07-27T13:00:00.000Z";
const confirmedRecoveryObservedAt = "2026-07-27T14:16:00.000Z";
const now = new Date("2026-07-27T14:00:00.000Z");
const repository = new PostgresSupplierMirrorRepository(pool, () => now);
const mirror = new SupplierMirrorService(repository);
const profitRepository = new PostgresProfitEngineRepository(pool, () => now);
const profitEngine = new ProfitEngineService(profitRepository, profitRepository, profitRepository);

try {
  await seedScope();
  const profitability = await profitEngine.auditListing(accountId, listingId);
  assert(profitability.status === "profitable", "seed economics must be profitable");

  const initial = observation({
    stockQuantity: 0,
    observedAt: firstObservedAt,
    evidenceHash: "a".repeat(64),
  });
  const initialRecord = await mirror.recordObservation(initial);
  assert(initialRecord.recorded, "the first supplier observation must be recorded");
  assert(
    initialRecord.product.consecutiveSuccessfulSyncs === 1,
    "the first successful supplier sync must be counted",
  );

  await seedListingLink();

  const firstRecovery = observation({
    stockQuantity: 5,
    observedAt: firstRecoveryObservedAt,
    evidenceHash: "b".repeat(64),
  });
  const firstRecoveryRecord = await mirror.recordObservation(firstRecovery);
  assert(firstRecoveryRecord.recorded, "the first recovery observation must be recorded");
  assert(firstRecoveryRecord.product.previousStock === 0, "the mirror must retain previous stock");
  assert(firstRecoveryRecord.product.currentStock === 5, "the mirror must expose current stock");

  await assertRejects(
    mirror.recordObservation(
      observation({
        stockQuantity: 9,
        observedAt: "2026-07-27T12:30:00.000Z",
        evidenceHash: "f".repeat(64),
      }),
    ),
    /must be newer/,
    "an out-of-order observation must not replace current state",
  );

  const duplicateFirstRecovery = await mirror.recordObservation(firstRecovery);
  assert(!duplicateFirstRecovery.recorded, "an identical observation must be idempotent");
  const firstRecoveryInput = await repository.read(accountId, listingId, supplierSourceId);
  assert(
    firstRecoveryInput.consecutiveSuccessfulSyncs === 1,
    "the first available observation must not satisfy recovery debounce",
  );
  assert(
    firstRecoveryInput.profitabilityStatus === "profitable",
    "profitability must match the current listing price and economic product cost",
  );

  const firstLease = await repository.claim({
    owner: "supplier-smoke-a",
    now: now.toISOString(),
    leaseUntil: new Date(now.getTime() + 30_000).toISOString(),
    limit: 1,
  });
  const competingLease = await repository.claim({
    owner: "supplier-smoke-b",
    now: now.toISOString(),
    leaseUntil: new Date(now.getTime() + 30_000).toISOString(),
    limit: 1,
  });
  assert(firstLease.length === 1, "the linked supplier listing must be leased exactly once");
  assert(competingLease.length === 0, "a competing worker must not lease the same link");
  await repository.complete({
    candidate: firstLease[0],
    owner: "supplier-smoke-a",
    nextAuditAt: now.toISOString(),
  });

  const service = new SupplierStockService(repository, repository, repository, repository);
  const daemon = new SupplierStockAuditDaemon(service, repository, {
    workerId: "supplier-smoke-daemon",
    leaseMs: 30_000,
    successIntervalMs: 900_000,
    retryIntervalMs: 60_000,
    now: () => now,
  });
  const firstAudit = await daemon.runOnce(10);
  assert(
    firstAudit.leased === 1 && firstAudit.evaluated === 1 && firstAudit.failed === 0,
    "first stock recovery audit failed",
  );
  assert(
    firstAudit.proposals === 0,
    "one available observation must not create a reactivation proposal",
  );

  now.setTime(new Date(confirmedRecoveryObservedAt).getTime());
  const confirmedRecovery = observation({
    stockQuantity: 5,
    observedAt: confirmedRecoveryObservedAt,
    evidenceHash: "c".repeat(64),
  });
  const confirmedRecoveryRecord = await mirror.recordObservation(confirmedRecovery);
  assert(confirmedRecoveryRecord.recorded, "the confirmation observation must be recorded");
  const duplicateConfirmedRecovery = await mirror.recordObservation(confirmedRecovery);
  assert(!duplicateConfirmedRecovery.recorded, "the confirmation duplicate must be idempotent");
  const confirmedInput = await repository.read(accountId, listingId, supplierSourceId);
  assert(
    confirmedInput.consecutiveSuccessfulSyncs === 2,
    "two unique available observations must satisfy recovery debounce",
  );

  const confirmedAudit = await daemon.runOnce(10);
  assert(
    confirmedAudit.leased === 1 && confirmedAudit.evaluated === 1 && confirmedAudit.failed === 0,
    "confirmed stock recovery audit failed",
  );
  assert(
    confirmedAudit.proposals === 1,
    "verified and confirmed stock recovery must create one proposal",
  );

  await pool.query(
    `UPDATE supplier_listing_links
     SET next_audit_at = $4
     WHERE account_id = $1 AND listing_id = $2 AND supplier_source_id = $3`,
    [accountId, listingId, supplierSourceId, now.toISOString()],
  );
  const repeatedAudit = await daemon.runOnce(10);
  assert(repeatedAudit.evaluated === 1, "the same state must remain auditable");

  const counts = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM supplier_product_observations
         WHERE account_id = $1) AS observations,
       (SELECT count(*)::int FROM supplier_stock_assessments
         WHERE account_id = $1) AS assessments,
       (SELECT count(*)::int FROM supplier_availability_proposals
         WHERE account_id = $1) AS proposals`,
    [accountId],
  );
  assert(
    counts.rows[0]?.observations === 3,
    "duplicates and out-of-order observations must not be appended",
  );
  assert(
    counts.rows[0]?.assessments === 2,
    "only materially different assessments must be persisted",
  );
  assert(counts.rows[0]?.proposals === 1, "identical proposals must be idempotent");

  const proposal = await pool.query(
    `SELECT proposal_kind, status, policy_version, payload_json
     FROM supplier_availability_proposals WHERE account_id = $1 LIMIT 1`,
    [accountId],
  );
  assert(
    proposal.rows[0]?.proposal_kind === "listing.reactivate",
    "recovery must propose reactivation",
  );
  assert(
    proposal.rows[0]?.status === "pending-approval",
    "reactivation must remain approval-gated",
  );
  assert(
    proposal.rows[0]?.policy_version === "supplier-stock-v1",
    "the durable proposal must preserve its policy version",
  );
  assert(
    proposal.rows[0]?.payload_json?.requiresApproval === true,
    "the durable proposal must preserve approval requirement",
  );

  console.log(
    "✓ Supplier Mirror ordering, debounce, economic evidence, leases and governed reactivation verified",
  );
} finally {
  await cleanup();
  await pool.end();
}

function observation({ stockQuantity, observedAt, evidenceHash }) {
  return Object.freeze({
    organizationId,
    accountId,
    supplierSourceId,
    sourceType: "online",
    sku,
    name: "Supplier Mirror Smoke Product",
    stockQuantity,
    unitCostMinor: 5_000,
    syncSucceeded: true,
    observedAt,
    evidence: Object.freeze({
      id: `supplier-evidence-${evidenceHash.slice(0, 8)}`,
      source: "supplier-smoke",
      observedAt,
      contentHash: evidenceHash,
    }),
  });
}

async function seedScope() {
  await pool.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
    organizationId,
    "Supplier Mirror Smoke",
  ]);
  await pool.query(
    `INSERT INTO commerce_accounts
      (id, organization_id, name, channel, market, minimum_margin_bps, autonomy_level)
     VALUES ($1, $2, $3, 'mercadolibre', 'MLC', 3000, 'ask')`,
    [accountId, organizationId, "Supplier Smoke Account"],
  );
  await pool.query(
    `INSERT INTO supplier_sources
      (id, organization_id, account_id, name, source_type, active)
     VALUES ($1, $2, $3, $4, 'online', true)`,
    [supplierSourceId, organizationId, accountId, "Supplier Smoke Source"],
  );
  const listing = Object.freeze({
    organizationId,
    accountId,
    sellerId,
    itemId: listingId,
    title: "Supplier Mirror Smoke Listing",
    status: "paused",
    priceMinor: 12_000,
    currencyId: "CLP",
    availableQuantity: 0,
    soldQuantity: 2,
    observedAt: now.toISOString(),
    sourceHash: "d".repeat(64),
  });
  await pool.query(
    `INSERT INTO mercadolibre_listing_snapshots
      (account_id, organization_id, seller_id, item_id, observed_at, payload_json)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [accountId, organizationId, sellerId, listingId, now.toISOString(), JSON.stringify(listing)],
  );
  await pool.query(
    `INSERT INTO economic_listing_policies
      (organization_id, account_id, listing_id, variable_rate_bps,
       variable_rate_evidence_id, variable_rate_evidence_source,
       variable_rate_observed_at, variable_rate_content_hash, target_margin_bps,
       maximum_increase_bps, maximum_evidence_age_ms, policy_version, next_audit_at)
     VALUES ($1, $2, $3, 1600, $4, 'mercadolibre', $5, $6,
       3000, 2000, 86400000, 'supplier-smoke-economic-v1', $5)`,
    [
      organizationId,
      accountId,
      listingId,
      `supplier-fee-${suffix}`,
      now.toISOString(),
      "e".repeat(64),
    ],
  );
  await pool.query(
    `INSERT INTO economic_cost_observations
      (organization_id, account_id, listing_id, cost_kind, amount_minor,
       evidence_id, evidence_source, observed_at, content_hash)
     VALUES
       ($1, $2, $3, 'product-cost', 5000, $4, 'supplier-smoke', $6, $7),
       ($1, $2, $3, 'fulfillment-cost', 500, $5, 'fulfillment-smoke', $6, $8)`,
    [
      organizationId,
      accountId,
      listingId,
      productCostEvidenceId,
      fulfillmentCostEvidenceId,
      now.toISOString(),
      "1".repeat(64),
      "2".repeat(64),
    ],
  );
}

async function seedListingLink() {
  await pool.query(
    `INSERT INTO supplier_listing_links
      (organization_id, account_id, supplier_source_id, sku, listing_id,
       recovery_stock_threshold, recovery_consecutive_syncs,
       cost_change_alert_bps, maximum_evidence_age_ms, policy_version, next_audit_at)
     VALUES ($1, $2, $3, $4, $5, 2, 2, 500, 86400000, 'supplier-stock-v1', $6)`,
    [organizationId, accountId, supplierSourceId, sku, listingId, now.toISOString()],
  );
}

async function cleanup() {
  for (const table of [
    "supplier_availability_proposals",
    "supplier_stock_assessments",
    "supplier_listing_links",
    "supplier_product_observations",
    "supplier_products",
    "supplier_sources",
    "profitability_snapshots",
    "economic_cost_observations",
    "economic_listing_policies",
    "mercadolibre_listing_snapshots",
  ]) {
    await pool
      .query(`DELETE FROM ${table} WHERE account_id = $1`, [accountId])
      .catch(() => undefined);
  }
  await pool
    .query(`DELETE FROM commerce_accounts WHERE id = $1`, [accountId])
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
