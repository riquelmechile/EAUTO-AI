import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  SupplierMirrorService,
  SupplierStockDaemon,
  SupplierStockService,
} from "../packages/application/dist/index.js";
import { PostgresSupplierStockRepository } from "../packages/infrastructure/dist/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for the supplier-stock smoke.");

const pool = new Pool({ connectionString: databaseUrl });
const suffix = randomUUID().replaceAll("-", "");
const organizationId = `supplier-org-${suffix}`;
const accountId = `supplier-account-${suffix}`;
const listingId = `MLC${suffix.slice(0, 12)}`;
const supplierSourceId = `supplier-source-${suffix}`;
const sellerId = `seller-${suffix}`;
const now = new Date("2026-07-27T13:00:00.000Z");
const repository = new PostgresSupplierStockRepository(pool, () => now);
const mirror = new SupplierMirrorService(repository);

try {
  await seed();

  const firstObservation = observation({
    stockQuantity: 3,
    observedAt: "2026-07-27T12:00:00.000Z",
    stockHash: "a".repeat(64),
    costHash: "b".repeat(64),
  });
  assert((await mirror.recordObservation(firstObservation)) === "recorded", "first observation failed");
  assert((await mirror.recordObservation(firstObservation)) === "duplicate", "duplicate was not ignored");
  assert(
    (await mirror.recordObservation(
      observation({
        stockQuantity: 0,
        observedAt: "2026-07-27T12:05:00.000Z",
        stockHash: "c".repeat(64),
        costHash: "d".repeat(64),
      }),
    )) === "recorded",
    "second observation failed",
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
  assert(firstLease.length === 1, "supplier listing must be leased exactly once");
  assert(competingLease.length === 0, "competing worker leased the same supplier listing");
  await repository.complete({
    candidate: firstLease[0],
    owner: "supplier-smoke-a",
    nextEvaluationAt: now.toISOString(),
  });

  const service = new SupplierStockService(repository, repository, repository, repository);
  const daemon = new SupplierStockDaemon(service, repository, {
    workerId: "supplier-smoke-daemon",
    leaseMs: 30_000,
    successIntervalMs: 900_000,
    retryIntervalMs: 60_000,
    now: () => now,
  });
  const firstRun = await daemon.runOnce(10);
  assert(
    firstRun.leased === 1 &&
      firstRun.evaluated === 1 &&
      firstRun.proposals === 1 &&
      firstRun.failed === 0,
    "supplier stock daemon failed to create the pause proposal",
  );

  await pool.query(
    `UPDATE supplier_listing_links SET next_evaluation_at = $3
     WHERE account_id = $1 AND listing_id = $2`,
    [accountId, listingId, now.toISOString()],
  );
  const secondRun = await daemon.runOnce(10);
  assert(secondRun.evaluated === 1 && secondRun.failed === 0, "repeat evaluation failed");

  const counts = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM supplier_stock_observations WHERE account_id = $1) AS observations,
       (SELECT count(*)::int FROM supplier_stock_assessments WHERE account_id = $1) AS assessments,
       (SELECT count(*)::int FROM stock_availability_proposals WHERE account_id = $1) AS proposals,
       (SELECT count(*)::int FROM economic_cost_observations
          WHERE account_id = $1 AND listing_id = $2 AND cost_kind = 'product-cost') AS product_costs`,
    [accountId, listingId],
  );
  assert(counts.rows[0]?.observations === 2, "supplier observations are not idempotent");
  assert(counts.rows[0]?.assessments === 1, "supplier assessments are not idempotent");
  assert(counts.rows[0]?.proposals === 1, "availability proposals are not idempotent");
  assert(counts.rows[0]?.product_costs === 1, "supplier cost did not feed the Profit Engine");

  const proposal = await pool.query(
    `SELECT kind, status FROM stock_availability_proposals
     WHERE account_id = $1 AND listing_id = $2 LIMIT 1`,
    [accountId, listingId],
  );
  assert(
    proposal.rows[0]?.kind === "listing.pause" && proposal.rows[0]?.status === "pending-approval",
    "supplier zero stock must remain an approval-gated pause proposal",
  );

  console.log("✓ Supplier Mirror ingestion, leases, Profit Engine feed and stock proposal verified");
} finally {
  await cleanup();
  await pool.end();
}

function observation({ stockQuantity, observedAt, stockHash, costHash }) {
  return Object.freeze({
    organizationId,
    accountId,
    listingId,
    supplierSourceId,
    sourceType: "online",
    stockQuantity,
    unitCostMinor: 5_000,
    syncSucceeded: true,
    stockEvidence: Object.freeze({
      id: `stock-${stockHash.slice(0, 8)}-${suffix}`,
      source: "supplier-smoke",
      observedAt,
      contentHash: stockHash,
    }),
    costEvidence: Object.freeze({
      id: `cost-${costHash.slice(0, 8)}-${suffix}`,
      source: "supplier-smoke",
      observedAt,
      contentHash: costHash,
    }),
  });
}

async function seed() {
  await pool.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
    organizationId,
    "Supplier Stock Smoke",
  ]);
  await pool.query(
    `INSERT INTO commerce_accounts
      (id, organization_id, name, channel, market, minimum_margin_bps, autonomy_level)
     VALUES ($1, $2, $3, 'mercadolibre', 'MLC', 3000, 'ask')`,
    [accountId, organizationId, "Supplier Smoke Account"],
  );
  const listing = Object.freeze({
    organizationId,
    accountId,
    sellerId,
    itemId: listingId,
    title: "Supplier Stock Smoke Listing",
    status: "active",
    priceMinor: 10_000,
    currencyId: "CLP",
    availableQuantity: 10,
    soldQuantity: 2,
    observedAt: now.toISOString(),
    sourceHash: "e".repeat(64),
  });
  await pool.query(
    `INSERT INTO mercadolibre_listing_snapshots
      (account_id, organization_id, seller_id, item_id, observed_at, payload_json)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [accountId, organizationId, sellerId, listingId, now.toISOString(), JSON.stringify(listing)],
  );
  await pool.query(
    `INSERT INTO economic_listing_policies
      (organization_id, account_id, listing_id, variable_rate_bps,
       variable_rate_evidence_id, variable_rate_evidence_source,
       variable_rate_observed_at, variable_rate_content_hash, target_margin_bps,
       maximum_increase_bps, maximum_evidence_age_ms, policy_version, next_audit_at)
     VALUES ($1,$2,$3,1600,$4,'mercadolibre',$5,$6,3000,2000,86400000,'supplier-smoke-v1',$5)`,
    [organizationId, accountId, listingId, `fee-${suffix}`, now.toISOString(), "f".repeat(64)],
  );
  await pool.query(
    `INSERT INTO supplier_sources
      (id, organization_id, account_id, name, source_type, maximum_evidence_age_ms)
     VALUES ($1,$2,$3,$4,'online',86400000)`,
    [supplierSourceId, organizationId, accountId, "Supplier Smoke Source"],
  );
  await pool.query(
    `INSERT INTO supplier_listing_links
      (organization_id, account_id, listing_id, supplier_source_id, source_sku,
       recovery_stock_threshold, recovery_consecutive_syncs, cost_change_alert_bps,
       policy_version, next_evaluation_at)
     VALUES ($1,$2,$3,$4,$5,2,2,500,'supplier-stock-smoke-v1',$6)`,
    [organizationId, accountId, listingId, supplierSourceId, `SKU-${suffix}`, now.toISOString()],
  );
}

async function cleanup() {
  for (const table of [
    "stock_availability_proposals",
    "supplier_stock_assessments",
    "supplier_stock_observations",
    "supplier_listing_links",
    "supplier_sources",
    "economic_cost_observations",
    "economic_listing_policies",
    "mercadolibre_listing_snapshots",
  ]) {
    await pool.query(`DELETE FROM ${table} WHERE account_id = $1`, [accountId]).catch(() => undefined);
  }
  await pool.query(`DELETE FROM commerce_accounts WHERE id = $1`, [accountId]).catch(() => undefined);
  await pool.query(`DELETE FROM organizations WHERE id = $1`, [organizationId]).catch(() => undefined);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
