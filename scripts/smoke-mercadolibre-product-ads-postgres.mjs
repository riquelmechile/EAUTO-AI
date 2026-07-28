import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresMercadoLibreProductAdsRepository } from "@eauto/infrastructure";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for Product Ads smoke.");

const pool = new Pool({ connectionString: databaseUrl });
const suffix = randomUUID().replaceAll("-", "");
const organizationId = `ads-org-${suffix}`;
const accountId = `ads-account-${suffix}`;
const foreignAccountId = `ads-foreign-${suffix}`;
const sellerId = `seller-${suffix}`;
const advertiserId = `9${suffix.slice(0, 10)}`;
const campaignId = `campaign-${suffix}`;
const adGroupId = `group-${suffix}`;
const itemId = `MLC${suffix.slice(0, 12)}`;
const observedAt = "2026-07-28T18:00:00.000Z";
const dateFrom = "2026-07-01";
const dateTo = "2026-07-28";
const repository = new PostgresMercadoLibreProductAdsRepository(pool);

const metrics = Object.freeze({
  clicks: 10,
  prints: 1_000,
  costMinor: 2_000,
  cpcMinor: 200,
  directAmountMinor: 8_000,
  indirectAmountMinor: 2_000,
  totalAmountMinor: 10_000,
  directUnitsQuantity: 2,
  indirectUnitsQuantity: 1,
  unitsQuantity: 3,
  directItemsQuantity: 1,
  indirectItemsQuantity: 1,
  advertisingItemsQuantity: 1,
  organicUnitsQuantity: 4,
  organicAmountMinor: 20_000,
  organicItemsQuantity: 2,
  ctr: 1,
  cvr: 30,
  acos: 20,
  tacos: 6.67,
  roas: 5,
  sov: 42,
});

try {
  await seedAccountsAndEconomics();

  const campaign = Object.freeze({
    organizationId,
    accountId,
    sellerId,
    advertiserId,
    siteId: "MLC",
    campaignId,
    name: "Product Ads smoke campaign",
    status: "active",
    dateFrom,
    dateTo,
    metrics,
    observedAt,
    sourceHash: hash({ campaignId, metrics }),
  });
  const adGroup = Object.freeze({
    organizationId,
    accountId,
    sellerId,
    advertiserId,
    siteId: "MLC",
    campaignId,
    adGroupId,
    externalId: itemId,
    type: "listing",
    status: "active",
    dateFrom,
    dateTo,
    metrics,
    observedAt,
    sourceHash: hash({ campaignId, adGroupId, metrics }),
  });
  const item = Object.freeze({
    organizationId,
    accountId,
    sellerId,
    advertiserId,
    siteId: "MLC",
    campaignId,
    adGroupId,
    itemId,
    title: "Product Ads smoke listing",
    status: "active",
    priceMinor: 10_000,
    metrics,
    dateFrom,
    dateTo,
    observedAt,
    sourceHash: hash({ campaignId, adGroupId, itemId, metrics }),
  });
  const reconciliationPayload = {
    organizationId,
    accountId,
    sellerId,
    advertiserId,
    itemId,
    dateFrom,
    dateTo,
    listingPriceMinor: 10_000,
    adsPriceMinor: 10_000,
    profitabilityPriceMinor: 9_500,
    listingToProfitabilityDriftMinor: 500,
    listingToAdsDriftMinor: 0,
    adsCostMinor: 2_000,
    adsRevenueMinor: 10_000,
    attribution: "direct-item-metrics",
    status: "price-drift",
    observedAt,
  };
  const reconciliation = Object.freeze({
    ...reconciliationPayload,
    sourceHash: hash(reconciliationPayload),
  });

  await repository.replace({
    accountId,
    campaigns: [campaign],
    adGroups: [adGroup],
    items: [item],
    reconciliations: [reconciliation],
  });

  const campaigns = await repository.listCampaigns(accountId);
  const adGroups = await repository.listAdGroups(accountId);
  const items = await repository.listItems(accountId);
  const reconciliations = await repository.listReconciliations(accountId);
  const profit = await repository.readLatest(accountId, itemId);
  assert(campaigns.length === 1 && campaigns[0]?.campaignId === campaignId, "campaign missing");
  assert(adGroups.length === 1 && adGroups[0]?.adGroupId === adGroupId, "Ad Group missing");
  assert(items.length === 1 && items[0]?.itemId === itemId, "item missing");
  assert(
    reconciliations.length === 1 && reconciliations[0]?.status === "price-drift",
    "reconciliation missing",
  );
  assert(profit?.salePriceMinor === 9_500, "latest Profit Engine snapshot was not restored");

  await repository.replace({
    accountId,
    campaigns: [Object.freeze({ ...campaign, name: "Updated campaign" })],
    adGroups: [],
    items: [],
    reconciliations: [],
  });
  assert((await repository.listCampaigns(accountId))[0]?.name === "Updated campaign", "replace failed");
  assert((await repository.listAdGroups(accountId)).length === 0, "stale Ad Groups were retained");
  assert((await repository.listItems(accountId)).length === 0, "stale items were retained");
  assert(
    (await repository.listReconciliations(accountId)).length === 0,
    "stale reconciliations were retained",
  );
  assert((await repository.listCampaigns(foreignAccountId)).length === 0, "tenant data leaked");

  const counts = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM mercadolibre_product_ads_campaign_snapshots WHERE account_id = $1) AS campaigns,
       (SELECT count(*)::int FROM mercadolibre_product_ads_ad_group_snapshots WHERE account_id = $1) AS ad_groups,
       (SELECT count(*)::int FROM mercadolibre_product_ads_item_snapshots WHERE account_id = $1) AS items,
       (SELECT count(*)::int FROM mercadolibre_economic_reconciliation_snapshots WHERE account_id = $1) AS reconciliations`,
    [accountId],
  );
  assert(counts.rows[0]?.campaigns === 1, "campaign replacement was not atomic");
  assert(counts.rows[0]?.ad_groups === 0, "Ad Group replacement was not atomic");
  assert(counts.rows[0]?.items === 0, "item replacement was not atomic");
  assert(counts.rows[0]?.reconciliations === 0, "reconciliation replacement was not atomic");

  console.log("✓ Product Ads snapshots, economic reconciliation and tenant isolation verified");
} finally {
  await cleanup();
  await pool.end();
}

async function seedAccountsAndEconomics() {
  await pool.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
    organizationId,
    "Product Ads smoke organization",
  ]);
  for (const [id, name] of [
    [accountId, "Product Ads smoke account"],
    [foreignAccountId, "Product Ads foreign account"],
  ]) {
    await pool.query(
      `INSERT INTO commerce_accounts
        (id, organization_id, name, channel, market, minimum_margin_bps, autonomy_level)
       VALUES ($1, $2, $3, 'mercadolibre', 'MLC', 3000, 'ask')`,
      [id, organizationId, name],
    );
  }
  const listing = Object.freeze({
    organizationId,
    accountId,
    sellerId,
    itemId,
    title: "Product Ads smoke listing",
    status: "active",
    priceMinor: 10_000,
    currencyId: "CLP",
    availableQuantity: 10,
    soldQuantity: 2,
    observedAt,
    sourceHash: "a".repeat(64),
  });
  await pool.query(
    `INSERT INTO mercadolibre_listing_snapshots
      (account_id, organization_id, seller_id, item_id, observed_at, payload_json)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [accountId, organizationId, sellerId, itemId, observedAt, JSON.stringify(listing)],
  );
  const profit = Object.freeze({
    status: "profitable",
    accountId,
    listingId: itemId,
    currency: "CLP",
    salePriceMinor: 9_500,
    quantity: 1,
    minimumMarginBps: 3_000,
    variableRateBps: 1_600,
    grossRevenueMinor: 9_500,
    fixedCostsMinor: 5_000,
    variableCostsMinor: 1_520,
    totalCostsMinor: 6_520,
    netProfitMinor: 2_980,
    marginBps: 3_136,
    evidenceRefs: Object.freeze(["profit-ads-smoke"]),
    calculatedAt: observedAt,
  });
  const contentHash = hash(profit);
  await pool.query(
    `INSERT INTO profitability_snapshots
      (id, organization_id, account_id, listing_id, status, calculated_at, content_hash, payload_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      `profit_${contentHash}`,
      organizationId,
      accountId,
      itemId,
      profit.status,
      profit.calculatedAt,
      contentHash,
      JSON.stringify(profit),
    ],
  );
}

async function cleanup() {
  for (const table of [
    "mercadolibre_economic_reconciliation_snapshots",
    "mercadolibre_product_ads_item_snapshots",
    "mercadolibre_product_ads_ad_group_snapshots",
    "mercadolibre_product_ads_campaign_snapshots",
    "profitability_snapshots",
    "mercadolibre_listing_snapshots",
  ]) {
    await pool.query(`DELETE FROM ${table} WHERE account_id = $1`, [accountId]).catch(() => undefined);
  }
  await pool
    .query(`DELETE FROM commerce_accounts WHERE organization_id = $1`, [organizationId])
    .catch(() => undefined);
  await pool.query(`DELETE FROM organizations WHERE id = $1`, [organizationId]).catch(() => undefined);
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
