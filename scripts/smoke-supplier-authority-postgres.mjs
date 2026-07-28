import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresSupplierMirrorRepository } from "@eauto/infrastructure";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for the supplier authority smoke.");

const pool = new Pool({ connectionString: databaseUrl });
const suffix = randomUUID().replaceAll("-", "");
const organizationId = `supplier-authority-org-${suffix}`;
const accountId = `supplier-authority-account-${suffix}`;
const listingId = `MLC-AUTH-${suffix.slice(0, 12)}`;
const primarySourceId = `supplier-authority-primary-${suffix}`;
const secondarySourceId = `supplier-authority-secondary-${suffix}`;
const primarySku = `PRIMARY-${suffix.slice(0, 12)}`;
const secondarySku = `SECONDARY-${suffix.slice(0, 12)}`;
const now = new Date("2026-07-27T15:00:00.000Z");
const repository = new PostgresSupplierMirrorRepository(pool, () => now);

try {
  await pool.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
    organizationId,
    "Supplier authority smoke organization",
  ]);
  await pool.query(
    `INSERT INTO commerce_accounts
      (id, organization_id, name, channel, market, minimum_margin_bps, autonomy_level)
     VALUES ($1,$2,$3,'mercadolibre','MLC',3000,'ask')`,
    [accountId, organizationId, "Supplier authority smoke account"],
  );
  await pool.query(
    `INSERT INTO supplier_sources
      (id, organization_id, account_id, name, source_type, active)
     VALUES
      ($1,$3,$4,'Primary supplier','online',true),
      ($2,$3,$4,'Secondary supplier','online',true)`,
    [primarySourceId, secondarySourceId, organizationId, accountId],
  );

  await insertProduct(primarySourceId, primarySku, "a".repeat(64));
  await insertProduct(secondarySourceId, secondarySku, "b".repeat(64));
  await insertLink(primarySourceId, primarySku);
  await insertLink(secondarySourceId, secondarySku);

  const initialAuthority = await pool.query(
    `SELECT supplier_source_id, cost_authoritative, availability_authoritative,
       next_audit_at = 'infinity'::timestamptz AS audit_disabled
     FROM supplier_listing_links
     WHERE account_id = $1 AND listing_id = $2
     ORDER BY supplier_source_id`,
    [accountId, listingId],
  );
  const primary = initialAuthority.rows.find((row) => row.supplier_source_id === primarySourceId);
  const secondary = initialAuthority.rows.find(
    (row) => row.supplier_source_id === secondarySourceId,
  );
  assert(
    primary?.cost_authoritative === true && primary.availability_authoritative === true,
    "the first active supplier link must become authoritative",
  );
  assert(
    secondary?.cost_authoritative === false &&
      secondary.availability_authoritative === false &&
      secondary.audit_disabled === true,
    "a secondary supplier must remain non-authoritative and non-leasable",
  );

  const firstClaim = await repository.claim({
    owner: "supplier-authority-worker-a",
    now: now.toISOString(),
    leaseUntil: new Date(now.getTime() + 30_000).toISOString(),
    limit: 10,
  });
  assert(firstClaim.length === 1, "only one authoritative supplier link may be leased");
  assert(
    firstClaim[0]?.supplierSourceId === primarySourceId,
    "the initial authoritative supplier must own the availability audit",
  );
  await repository.complete({
    candidate: firstClaim[0],
    owner: "supplier-authority-worker-a",
    nextAuditAt: new Date(now.getTime() + 900_000).toISOString(),
  });

  await pool.query(
    `UPDATE supplier_listing_links
     SET cost_authoritative = false, availability_authoritative = false
     WHERE account_id = $1 AND listing_id = $2 AND supplier_source_id = $3`,
    [accountId, listingId, primarySourceId],
  );
  await pool.query(
    `UPDATE supplier_listing_links
     SET cost_authoritative = true, availability_authoritative = true
     WHERE account_id = $1 AND listing_id = $2 AND supplier_source_id = $3`,
    [accountId, listingId, secondarySourceId],
  );

  const transferredClaim = await repository.claim({
    owner: "supplier-authority-worker-b",
    now: now.toISOString(),
    leaseUntil: new Date(now.getTime() + 30_000).toISOString(),
    limit: 10,
  });
  assert(transferredClaim.length === 1, "authority transfer must expose exactly one due link");
  assert(
    transferredClaim[0]?.supplierSourceId === secondarySourceId,
    "the new authoritative supplier must own the availability audit",
  );

  console.log("✓ Supplier cost and availability authority isolate multi-provider leases");
} finally {
  await pool
    .query(`DELETE FROM supplier_listing_links WHERE account_id = $1`, [accountId])
    .catch(() => undefined);
  await pool
    .query(`DELETE FROM supplier_products WHERE account_id = $1`, [accountId])
    .catch(() => undefined);
  await pool
    .query(`DELETE FROM supplier_sources WHERE account_id = $1`, [accountId])
    .catch(() => undefined);
  await pool
    .query(`DELETE FROM commerce_accounts WHERE id = $1`, [accountId])
    .catch(() => undefined);
  await pool
    .query(`DELETE FROM organizations WHERE id = $1`, [organizationId])
    .catch(() => undefined);
  await pool.end();
}

async function insertProduct(supplierSourceId, sku, contentHash) {
  await pool.query(
    `INSERT INTO supplier_products
      (organization_id, account_id, supplier_source_id, sku, name,
       previous_stock_qty, stock_qty, previous_unit_cost_minor, unit_cost_minor,
       sync_succeeded, consecutive_successful_syncs, observed_at, evidence_id,
       evidence_source, evidence_content_hash, current_content_hash)
     VALUES ($1,$2,$3,$4,$5,5,5,5000,5000,true,1,$6,$7,'supplier-smoke',$8,$8)`,
    [
      organizationId,
      accountId,
      supplierSourceId,
      sku,
      `Supplier product ${sku}`,
      "2026-07-27T14:30:00.000Z",
      `supplier-authority-evidence-${supplierSourceId}`,
      contentHash,
    ],
  );
}

async function insertLink(supplierSourceId, sku) {
  await pool.query(
    `INSERT INTO supplier_listing_links
      (organization_id, account_id, supplier_source_id, sku, listing_id,
       recovery_stock_threshold, recovery_consecutive_syncs, cost_change_alert_bps,
       maximum_evidence_age_ms, policy_version, next_audit_at)
     VALUES ($1,$2,$3,$4,$5,2,2,500,86400000,'supplier-authority-v1',$6)`,
    [organizationId, accountId, supplierSourceId, sku, listingId, now.toISOString()],
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
