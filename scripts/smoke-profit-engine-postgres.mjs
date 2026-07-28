import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { MarginAuditDaemon, ProfitEngineService } from "@eauto/application";
import { PostgresProfitEngineRepository } from "@eauto/infrastructure";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for the profit-engine smoke.");

const pool = new Pool({ connectionString: databaseUrl });
const suffix = randomUUID().replaceAll("-", "");
const organizationId = `profit-org-${suffix}`;
const accountId = `profit-account-${suffix}`;
const listingId = `MLC${suffix.slice(0, 12)}`;
const sellerId = `seller-${suffix}`;
const now = new Date("2026-07-27T15:00:00.000Z");
const repository = new PostgresProfitEngineRepository(pool, () => now);

try {
  await seed();

  const firstLease = await repository.claim({
    owner: "profit-smoke-a",
    now: now.toISOString(),
    leaseUntil: new Date(now.getTime() + 30_000).toISOString(),
    limit: 1,
  });
  const competingLease = await repository.claim({
    owner: "profit-smoke-b",
    now: now.toISOString(),
    leaseUntil: new Date(now.getTime() + 30_000).toISOString(),
    limit: 1,
  });
  assert(firstLease.length === 1, "the due listing must be leased exactly once");
  assert(competingLease.length === 0, "a competing worker must not lease the same listing");
  await repository.complete({
    candidate: firstLease[0],
    owner: "profit-smoke-a",
    nextAuditAt: now.toISOString(),
  });

  const profitEngine = new ProfitEngineService(repository, repository, repository);
  const daemon = new MarginAuditDaemon(profitEngine, repository, repository, {
    workerId: "profit-smoke-daemon",
    leaseMs: 30_000,
    successIntervalMs: 900_000,
    retryIntervalMs: 60_000,
    now: () => now,
  });
  const audit = await daemon.runOnce(10);
  assert(audit.leased === 1 && audit.audited === 1 && audit.failed === 0, "margin audit failed");
  assert(audit.findings === 1, "below-floor economics must create an attention finding");

  const decision = await profitEngine.prepareRepricing(accountId, listingId, {
    targetMarginBps: 3_000,
    maximumIncreaseBps: 2_000,
    policyVersion: "profit-smoke-v1",
  });
  assert(decision.status === "proposed", "below-floor economics must produce a proposal");
  assert(decision.requiresApproval, "repricing must remain approval-gated");

  await profitEngine.prepareRepricing(accountId, listingId, {
    targetMarginBps: 3_000,
    maximumIncreaseBps: 2_000,
    policyVersion: "profit-smoke-v1",
  });

  const counts = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM profitability_snapshots WHERE account_id = $1) AS snapshots,
       (SELECT count(*)::int FROM margin_audit_findings WHERE account_id = $1) AS findings,
       (SELECT count(*)::int FROM repricing_proposals WHERE account_id = $1) AS proposals`,
    [accountId],
  );
  assert(counts.rows[0]?.snapshots === 1, "identical profitability snapshots must be idempotent");
  assert(counts.rows[0]?.findings === 1, "identical findings must be idempotent");
  assert(counts.rows[0]?.proposals === 1, "identical repricing proposals must be idempotent");

  const finding = await pool.query(
    `SELECT severity, status FROM margin_audit_findings WHERE account_id = $1 LIMIT 1`,
    [accountId],
  );
  assert(
    finding.rows[0]?.severity === "warning" && finding.rows[0]?.status === "below-floor",
    "the smoke listing must be classified as a below-floor warning",
  );

  console.log("✓ Profit Engine PostgreSQL reader, leases, audit and repricing verified");
} finally {
  await cleanup();
  await pool.end();
}

async function seed() {
  await pool.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
    organizationId,
    "Profit Engine Smoke",
  ]);
  await pool.query(
    `INSERT INTO commerce_accounts
      (id, organization_id, name, channel, market, minimum_margin_bps, autonomy_level)
     VALUES ($1, $2, $3, 'mercadolibre', 'MLC', 3000, 'ask')`,
    [accountId, organizationId, "Profit Smoke Account"],
  );
  const listing = Object.freeze({
    organizationId,
    accountId,
    sellerId,
    itemId: listingId,
    title: "Profit Engine Smoke Listing",
    status: "active",
    priceMinor: 10_000,
    currencyId: "CLP",
    availableQuantity: 10,
    soldQuantity: 2,
    observedAt: now.toISOString(),
    sourceHash: "a".repeat(64),
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
     VALUES ($1, $2, $3, 1600, $4, 'mercadolibre', $5, $6, 3000, 2000,
       86400000, 'profit-smoke-v1', $5)`,
    [organizationId, accountId, listingId, `fee-${suffix}`, now.toISOString(), "b".repeat(64)],
  );
  for (const cost of [
    ["product-cost", 5_000, "supplier", "c".repeat(64)],
    ["fulfillment-cost", 1_000, "mercadolibre", "d".repeat(64)],
  ]) {
    await pool.query(
      `INSERT INTO economic_cost_observations
        (organization_id, account_id, listing_id, cost_kind, amount_minor,
         evidence_id, evidence_source, observed_at, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        organizationId,
        accountId,
        listingId,
        cost[0],
        cost[1],
        `${cost[0]}-${suffix}`,
        cost[2],
        now.toISOString(),
        cost[3],
      ],
    );
  }
}

async function cleanup() {
  for (const table of [
    "margin_audit_findings",
    "repricing_proposals",
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
