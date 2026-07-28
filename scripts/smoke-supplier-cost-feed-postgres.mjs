import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { SupplierMirrorService } from "@eauto/application";
import { PostgresSupplierMirrorRepository } from "@eauto/infrastructure";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for supplier cost-feed smoke.");

const pool = new Pool({ connectionString: databaseUrl });
const suffix = randomUUID().replaceAll("-", "");
const organizationId = `supplier-cost-org-${suffix}`;
const accountId = `supplier-cost-account-${suffix}`;
const supplierSourceId = `supplier-cost-source-${suffix}`;
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

  await mirror.recordObservation(
    observation({
      unitCostMinor: 5_000,
      syncSucceeded: true,
      observedAt: "2026-07-27T12:00:00.000Z",
      evidenceHash: "a".repeat(64),
    }),
  );

  await seedListingLink();
  await assertEconomicCost(5_000, `supplier-cost-evidence-${"a".repeat(8)}`);

  await pool.query(
    `UPDATE economic_listing_policies
     SET next_audit_at = '2099-01-01T00:00:00.000Z'
     WHERE account_id = $1 AND listing_id = $2`,
    [accountId, listingId],
  );

  await mirror.recordObservation(
    observation({
      unitCostMinor: 5_500,
      syncSucceeded: true,
      observedAt: "2026-07-27T13:00:00.000Z",
      evidenceHash: "b".repeat(64),
    }),
  );
  await assertEconomicCost(5_500, `supplier-cost-evidence-${"b".repeat(8)}`);

  const policy = await pool.query(
    `SELECT next_audit_at <= now() AS due
     FROM economic_listing_policies
     WHERE account_id = $1 AND listing_id = $2`,
    [accountId, listingId],
  );
  assert(policy.rows[0]?.due === true, "supplier cost change did not schedule margin audit");

  await mirror.recordObservation(
    observation({
      unitCostMinor: 1,
      syncSucceeded: false,
      observedAt: "2026-07-27T14:00:00.000Z",
      evidenceHash: "c".repeat(64),
    }),
  );
  await assertEconomicCost(5_500, `supplier-cost-evidence-${"b".repeat(8)}`);

  console.log("✓ Supplier product cost feeds Profit Engine and ignores failed sync values");
} finally {
  await cleanup();
  await pool.end();
}

function observation({ unitCostMinor, syncSucceeded, observedAt, evidenceHash }) {
  return Object.freeze({
    organizationId,
    accountId,
    supplierSourceId,
    sourceType: "online",
    sku,
    name: "Supplier Cost Feed Product",
    stockQuantity: 5,
    unitCostMinor,
    syncSucceeded,
    observedAt,
    evidence: Object.freeze({
      id: `supplier-cost-evidence-${evidenceHash.slice(0, 8)}`,
      source: "supplier-cost-smoke",
      observedAt,
      contentHash: evidenceHash,
    }),
  });
}

async function seedScope() {
  await pool.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
    organizationId,
    "Supplier Cost Feed Smoke",
  ]);
  await pool.query(
    `INSERT INTO commerce_accounts
      (id, organization_id, name, channel, market, minimum_margin_bps, autonomy_level)
     VALUES ($1, $2, $3, 'mercadolibre', 'MLC', 3000, 'ask')`,
    [accountId, organizationId, "Supplier Cost Account"],
  );
  await pool.query(
    `INSERT INTO supplier_sources
      (id, organization_id, account_id, name, source_type, active)
     VALUES ($1, $2, $3, $4, 'online', true)`,
    [supplierSourceId, organizationId, accountId, "Supplier Cost Source"],
  );
  const listing = Object.freeze({
    organizationId,
    accountId,
    sellerId,
    itemId: listingId,
    title: "Supplier Cost Feed Listing",
    status: "paused",
    priceMinor: 12_000,
    currencyId: "CLP",
    availableQuantity: 0,
    soldQuantity: 0,
    observedAt: "2026-07-27T12:00:00.000Z",
    sourceHash: "d".repeat(64),
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
  await pool.query(
    `INSERT INTO economic_listing_policies
      (organization_id, account_id, listing_id, variable_rate_bps,
       variable_rate_evidence_id, variable_rate_evidence_source,
       variable_rate_observed_at, variable_rate_content_hash, target_margin_bps,
       maximum_increase_bps, maximum_evidence_age_ms, policy_version, next_audit_at)
     VALUES ($1, $2, $3, 1600, $4, 'mercadolibre', $5, $6,
       3000, 2000, 86400000, 'supplier-cost-smoke-v1', '2099-01-01T00:00:00.000Z')`,
    [
      organizationId,
      accountId,
      listingId,
      `supplier-cost-fee-${suffix}`,
      "2026-07-27T12:00:00.000Z",
      "e".repeat(64),
    ],
  );
}

async function seedListingLink() {
  await pool.query(
    `INSERT INTO supplier_listing_links
      (organization_id, account_id, supplier_source_id, sku, listing_id,
       recovery_stock_threshold, recovery_consecutive_syncs,
       cost_change_alert_bps, maximum_evidence_age_ms, policy_version, next_audit_at)
     VALUES ($1, $2, $3, $4, $5, 2, 2, 500, 86400000, 'supplier-cost-link-v1', now())`,
    [organizationId, accountId, supplierSourceId, sku, listingId],
  );
}

async function assertEconomicCost(expectedAmount, expectedEvidenceId) {
  const result = await pool.query(
    `SELECT amount_minor::text, evidence_id
     FROM economic_cost_observations
     WHERE account_id = $1 AND listing_id = $2 AND cost_kind = 'product-cost'`,
    [accountId, listingId],
  );
  assert(result.rows[0]?.amount_minor === String(expectedAmount), "unexpected economic product cost");
  assert(result.rows[0]?.evidence_id === expectedEvidenceId, "unexpected economic cost evidence");
}

async function cleanup() {
  for (const table of [
    "supplier_availability_proposals",
    "supplier_stock_assessments",
    "supplier_listing_links",
    "supplier_product_observations",
    "supplier_products",
    "supplier_sources",
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
