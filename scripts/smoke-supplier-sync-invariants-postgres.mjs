import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { SupplierMirrorService } from "@eauto/application";
import { PostgresSupplierMirrorRepository } from "@eauto/infrastructure";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for supplier invariant smoke.");

const pool = new Pool({ connectionString: databaseUrl });
const suffix = randomUUID().replaceAll("-", "");
const organizationId = `supplier-invariant-org-${suffix}`;
const accountId = `supplier-invariant-account-${suffix}`;
const supplierSourceId = `supplier-invariant-source-${suffix}`;
const sku = `SKU-${suffix.slice(0, 12)}`;
const listingId = `MLC${suffix.slice(0, 12)}`;
const sellerId = `seller-${suffix}`;
const repository = new PostgresSupplierMirrorRepository(
  pool,
  () => new Date("2026-07-27T16:00:00.000Z"),
);
const mirror = new SupplierMirrorService(repository);

try {
  await seedScope();

  await assertRejects(
    mirror.recordObservation(
      observation({
        sku: `${sku}-unverified`,
        stockQuantity: 99,
        unitCostMinor: 1,
        syncSucceeded: false,
        observedAt: "2026-07-27T11:00:00.000Z",
        evidenceHash: "0".repeat(64),
      }),
    ),
    /first supplier product observation must be successful/,
    "a failed first sync must not create current supplier state",
  );

  const initial = await mirror.recordObservation(
    observation({
      stockQuantity: 0,
      unitCostMinor: 5_000,
      syncSucceeded: true,
      observedAt: "2026-07-27T12:00:00.000Z",
      evidenceHash: "1".repeat(64),
    }),
  );
  assert(initial.product.currentStock === 0, "initial stock was not recorded");
  assert(
    initial.product.consecutiveSuccessfulSyncs === 1,
    "product telemetry must count the first successful sync",
  );

  await seedListingLink();
  assert((await recoveryConfirmationCount()) === 0, "new links must start unconfirmed");

  const failed = await mirror.recordObservation(
    observation({
      stockQuantity: 99,
      unitCostMinor: 1,
      syncSucceeded: false,
      observedAt: "2026-07-27T13:00:00.000Z",
      evidenceHash: "2".repeat(64),
    }),
  );
  assert(failed.product.syncSucceeded === false, "failed sync status was not retained");
  assert(failed.product.currentStock === 0, "failed sync overwrote last verified stock");
  assert(failed.product.currentUnitCostMinor === 5_000, "failed sync overwrote verified cost");
  assert(
    failed.product.consecutiveSuccessfulSyncs === 0,
    "failed sync did not reset product success telemetry",
  );
  assert((await recoveryConfirmationCount()) === 0, "failed sync did not reset link debounce");

  const firstRecovery = await mirror.recordObservation(
    observation({
      stockQuantity: 5,
      unitCostMinor: 5_000,
      syncSucceeded: true,
      observedAt: "2026-07-27T14:00:00.000Z",
      evidenceHash: "3".repeat(64),
    }),
  );
  assert(firstRecovery.product.previousStock === 0, "first recovery lost low-stock history");
  assert(firstRecovery.product.currentStock === 5, "first recovery stock was not stored");
  assert(
    firstRecovery.product.consecutiveSuccessfulSyncs === 1,
    "first successful sync after failure must restart product telemetry",
  );
  assert((await recoveryConfirmationCount()) === 1, "first recovery must start link debounce");

  await assertRejects(
    mirror.recordObservation(
      observation({
        stockQuantity: 50,
        unitCostMinor: 100,
        syncSucceeded: true,
        observedAt: "2026-07-27T13:30:00.000Z",
        evidenceHash: "4".repeat(64),
      }),
    ),
    /must be newer/,
    "out-of-order evidence must be rejected",
  );
  const afterDelayed = await currentProduct();
  assert(afterDelayed.stock_qty === "5", "out-of-order evidence regressed current stock");
  assert(afterDelayed.unit_cost_minor === "5000", "out-of-order evidence regressed current cost");
  assert(
    afterDelayed.consecutive_successful_syncs === 1,
    "out-of-order evidence changed product telemetry",
  );
  assert(
    (await recoveryConfirmationCount()) === 1,
    "out-of-order evidence changed link debounce",
  );

  const secondRecovery = await mirror.recordObservation(
    observation({
      stockQuantity: 5,
      unitCostMinor: 5_000,
      syncSucceeded: true,
      observedAt: "2026-07-27T15:00:00.000Z",
      evidenceHash: "5".repeat(64),
    }),
  );
  assert(
    secondRecovery.product.consecutiveSuccessfulSyncs === 2,
    "second post-failure success must advance product telemetry",
  );
  assert(
    (await recoveryConfirmationCount()) === 2,
    "second unique available observation must confirm link debounce",
  );

  const observationCount = await pool.query(
    `SELECT count(*)::int AS count
     FROM supplier_product_observations
     WHERE account_id = $1 AND supplier_source_id = $2 AND sku = $3`,
    [accountId, supplierSourceId, sku],
  );
  assert(
    observationCount.rows[0]?.count === 4,
    "failed, successful and recovery observations must be durable but delayed evidence must roll back",
  );

  console.log(
    "✓ Supplier failed-sync preservation, monotonic state and per-link recovery debounce verified",
  );
} finally {
  await cleanup();
  await pool.end();
}

function observation({
  sku: observationSku = sku,
  stockQuantity,
  unitCostMinor,
  syncSucceeded,
  observedAt,
  evidenceHash,
}) {
  return Object.freeze({
    organizationId,
    accountId,
    supplierSourceId,
    sourceType: "online",
    sku: observationSku,
    name: "Supplier Invariant Product",
    stockQuantity,
    unitCostMinor,
    syncSucceeded,
    observedAt,
    evidence: Object.freeze({
      id: `supplier-invariant-evidence-${evidenceHash.slice(0, 8)}`,
      source: "supplier-invariant-smoke",
      observedAt,
      contentHash: evidenceHash,
    }),
  });
}

async function seedScope() {
  await pool.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
    organizationId,
    "Supplier Invariant Smoke",
  ]);
  await pool.query(
    `INSERT INTO commerce_accounts
      (id, organization_id, name, channel, market, minimum_margin_bps, autonomy_level)
     VALUES ($1, $2, $3, 'mercadolibre', 'MLC', 3000, 'ask')`,
    [accountId, organizationId, "Supplier Invariant Account"],
  );
  await pool.query(
    `INSERT INTO supplier_sources
      (id, organization_id, account_id, name, source_type, active)
     VALUES ($1, $2, $3, $4, 'online', true)`,
    [supplierSourceId, organizationId, accountId, "Supplier Invariant Source"],
  );
  const listing = Object.freeze({
    organizationId,
    accountId,
    sellerId,
    itemId: listingId,
    title: "Supplier Invariant Listing",
    status: "paused",
    priceMinor: 10_000,
    currencyId: "CLP",
    availableQuantity: 0,
    soldQuantity: 0,
    observedAt: "2026-07-27T12:00:00.000Z",
    sourceHash: "6".repeat(64),
  });
  await pool.query(
    `INSERT INTO mercadolibre_listing_snapshots
      (account_id, organization_id, seller_id, item_id, observed_at, payload_json)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      accountId,
      organizationId,
      sellerId,
      listingId,
      listing.observedAt,
      JSON.stringify(listing),
    ],
  );
}

async function seedListingLink() {
  await pool.query(
    `INSERT INTO supplier_listing_links
      (organization_id, account_id, supplier_source_id, sku, listing_id,
       recovery_stock_threshold, recovery_consecutive_syncs,
       cost_change_alert_bps, maximum_evidence_age_ms, policy_version, next_audit_at)
     VALUES ($1, $2, $3, $4, $5, 2, 2, 500, 86400000, 'supplier-invariant-v1', now())`,
    [organizationId, accountId, supplierSourceId, sku, listingId],
  );
}

async function recoveryConfirmationCount() {
  const result = await pool.query(
    `SELECT recovery_confirmation_count
     FROM supplier_listing_links
     WHERE account_id = $1 AND listing_id = $2 AND supplier_source_id = $3`,
    [accountId, listingId, supplierSourceId],
  );
  return result.rows[0]?.recovery_confirmation_count;
}

async function currentProduct() {
  const result = await pool.query(
    `SELECT stock_qty::text, unit_cost_minor::text, consecutive_successful_syncs
     FROM supplier_products
     WHERE account_id = $1 AND supplier_source_id = $2 AND sku = $3`,
    [accountId, supplierSourceId, sku],
  );
  return result.rows[0];
}

async function cleanup() {
  for (const table of [
    "supplier_availability_proposals",
    "supplier_stock_assessments",
    "supplier_listing_links",
    "supplier_product_observations",
    "supplier_products",
    "supplier_sources",
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
