import type { Pool, PoolClient } from "pg";
import type {
  LatestProfitabilitySnapshotReader,
  MercadoLibreProductAdsRepository,
} from "@eauto/application";
import type {
  MercadoLibreEconomicReconciliationSnapshot,
  MercadoLibreProductAdsAdGroupSnapshot,
  MercadoLibreProductAdsCampaignSnapshot,
  MercadoLibreProductAdsItemSnapshot,
  ProfitabilitySnapshot,
} from "@eauto/domain";

export class InMemoryMercadoLibreProductAdsRepository
  implements MercadoLibreProductAdsRepository, LatestProfitabilitySnapshotReader
{
  private readonly campaigns = new Map<
    string,
    readonly MercadoLibreProductAdsCampaignSnapshot[]
  >();
  private readonly adGroups = new Map<
    string,
    readonly MercadoLibreProductAdsAdGroupSnapshot[]
  >();
  private readonly items = new Map<string, readonly MercadoLibreProductAdsItemSnapshot[]>();
  private readonly reconciliations = new Map<
    string,
    readonly MercadoLibreEconomicReconciliationSnapshot[]
  >();
  private readonly profitability = new Map<string, ProfitabilitySnapshot>();

  replace(input: {
    accountId: string;
    campaigns: readonly MercadoLibreProductAdsCampaignSnapshot[];
    adGroups: readonly MercadoLibreProductAdsAdGroupSnapshot[];
    items: readonly MercadoLibreProductAdsItemSnapshot[];
    reconciliations: readonly MercadoLibreEconomicReconciliationSnapshot[];
  }): Promise<void> {
    this.campaigns.set(input.accountId, Object.freeze([...input.campaigns]));
    this.adGroups.set(input.accountId, Object.freeze([...input.adGroups]));
    this.items.set(input.accountId, Object.freeze([...input.items]));
    this.reconciliations.set(input.accountId, Object.freeze([...input.reconciliations]));
    return Promise.resolve();
  }

  listCampaigns(accountId: string): Promise<readonly MercadoLibreProductAdsCampaignSnapshot[]> {
    return Promise.resolve(this.campaigns.get(accountId) ?? []);
  }

  listAdGroups(accountId: string): Promise<readonly MercadoLibreProductAdsAdGroupSnapshot[]> {
    return Promise.resolve(this.adGroups.get(accountId) ?? []);
  }

  listItems(accountId: string): Promise<readonly MercadoLibreProductAdsItemSnapshot[]> {
    return Promise.resolve(this.items.get(accountId) ?? []);
  }

  listReconciliations(
    accountId: string,
  ): Promise<readonly MercadoLibreEconomicReconciliationSnapshot[]> {
    return Promise.resolve(this.reconciliations.get(accountId) ?? []);
  }

  readLatest(accountId: string, listingId: string): Promise<ProfitabilitySnapshot | null> {
    return Promise.resolve(this.profitability.get(`${accountId}:${listingId}`) ?? null);
  }

  seedProfitability(snapshot: ProfitabilitySnapshot): void {
    this.profitability.set(`${snapshot.accountId}:${snapshot.listingId}`, snapshot);
  }
}

export class PostgresMercadoLibreProductAdsRepository
  implements MercadoLibreProductAdsRepository, LatestProfitabilitySnapshotReader
{
  constructor(private readonly pool: Pool) {}

  async replace(input: {
    accountId: string;
    campaigns: readonly MercadoLibreProductAdsCampaignSnapshot[];
    adGroups: readonly MercadoLibreProductAdsAdGroupSnapshot[];
    items: readonly MercadoLibreProductAdsItemSnapshot[];
    reconciliations: readonly MercadoLibreEconomicReconciliationSnapshot[];
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const table of [
        "mercadolibre_product_ads_campaign_snapshots",
        "mercadolibre_product_ads_ad_group_snapshots",
        "mercadolibre_product_ads_item_snapshots",
        "mercadolibre_economic_reconciliation_snapshots",
      ]) {
        await client.query(`DELETE FROM ${table} WHERE account_id = $1`, [input.accountId]);
      }
      for (const snapshot of input.campaigns) await insertCampaign(client, snapshot);
      for (const snapshot of input.adGroups) await insertAdGroup(client, snapshot);
      for (const snapshot of input.items) await insertItem(client, snapshot);
      for (const snapshot of input.reconciliations) await insertReconciliation(client, snapshot);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listCampaigns(
    accountId: string,
  ): Promise<readonly MercadoLibreProductAdsCampaignSnapshot[]> {
    return this.listPayloads<MercadoLibreProductAdsCampaignSnapshot>(
      "mercadolibre_product_ads_campaign_snapshots",
      accountId,
      "campaign_id",
    );
  }

  async listAdGroups(
    accountId: string,
  ): Promise<readonly MercadoLibreProductAdsAdGroupSnapshot[]> {
    return this.listPayloads<MercadoLibreProductAdsAdGroupSnapshot>(
      "mercadolibre_product_ads_ad_group_snapshots",
      accountId,
      "campaign_id, ad_group_id",
    );
  }

  async listItems(accountId: string): Promise<readonly MercadoLibreProductAdsItemSnapshot[]> {
    return this.listPayloads<MercadoLibreProductAdsItemSnapshot>(
      "mercadolibre_product_ads_item_snapshots",
      accountId,
      "campaign_id, ad_group_id, item_id",
    );
  }

  async listReconciliations(
    accountId: string,
  ): Promise<readonly MercadoLibreEconomicReconciliationSnapshot[]> {
    return this.listPayloads<MercadoLibreEconomicReconciliationSnapshot>(
      "mercadolibre_economic_reconciliation_snapshots",
      accountId,
      "status, item_id",
    );
  }

  async readLatest(accountId: string, listingId: string): Promise<ProfitabilitySnapshot | null> {
    const result = await this.pool.query<{ payload_json: ProfitabilitySnapshot }>(
      `SELECT payload_json
       FROM profitability_snapshots
       WHERE account_id = $1 AND listing_id = $2
       ORDER BY calculated_at DESC, created_at DESC
       LIMIT 1`,
      [accountId, listingId],
    );
    return result.rows[0]?.payload_json ?? null;
  }

  private async listPayloads<T>(
    table: string,
    accountId: string,
    orderBy: string,
  ): Promise<readonly T[]> {
    const result = await this.pool.query<{ payload_json: T }>(
      `SELECT payload_json FROM ${table} WHERE account_id = $1 ORDER BY ${orderBy}`,
      [accountId],
    );
    return Object.freeze(result.rows.map((row) => row.payload_json));
  }
}

async function insertCampaign(
  client: PoolClient,
  snapshot: MercadoLibreProductAdsCampaignSnapshot,
): Promise<void> {
  await client.query(
    `INSERT INTO mercadolibre_product_ads_campaign_snapshots
      (organization_id, account_id, seller_id, advertiser_id, campaign_id,
       date_from, date_to, observed_at, payload_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      snapshot.organizationId,
      snapshot.accountId,
      snapshot.sellerId,
      snapshot.advertiserId,
      snapshot.campaignId,
      snapshot.dateFrom,
      snapshot.dateTo,
      snapshot.observedAt,
      JSON.stringify(snapshot),
    ],
  );
}

async function insertAdGroup(
  client: PoolClient,
  snapshot: MercadoLibreProductAdsAdGroupSnapshot,
): Promise<void> {
  await client.query(
    `INSERT INTO mercadolibre_product_ads_ad_group_snapshots
      (organization_id, account_id, seller_id, advertiser_id, campaign_id, ad_group_id,
       date_from, date_to, observed_at, payload_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
    [
      snapshot.organizationId,
      snapshot.accountId,
      snapshot.sellerId,
      snapshot.advertiserId,
      snapshot.campaignId,
      snapshot.adGroupId,
      snapshot.dateFrom,
      snapshot.dateTo,
      snapshot.observedAt,
      JSON.stringify(snapshot),
    ],
  );
}

async function insertItem(
  client: PoolClient,
  snapshot: MercadoLibreProductAdsItemSnapshot,
): Promise<void> {
  await client.query(
    `INSERT INTO mercadolibre_product_ads_item_snapshots
      (organization_id, account_id, seller_id, advertiser_id, campaign_id, ad_group_id,
       item_id, date_from, date_to, observed_at, payload_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
    [
      snapshot.organizationId,
      snapshot.accountId,
      snapshot.sellerId,
      snapshot.advertiserId,
      snapshot.campaignId,
      snapshot.adGroupId,
      snapshot.itemId,
      snapshot.dateFrom,
      snapshot.dateTo,
      snapshot.observedAt,
      JSON.stringify(snapshot),
    ],
  );
}

async function insertReconciliation(
  client: PoolClient,
  snapshot: MercadoLibreEconomicReconciliationSnapshot,
): Promise<void> {
  await client.query(
    `INSERT INTO mercadolibre_economic_reconciliation_snapshots
      (organization_id, account_id, seller_id, advertiser_id, item_id, status,
       date_from, date_to, observed_at, source_hash, payload_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
    [
      snapshot.organizationId,
      snapshot.accountId,
      snapshot.sellerId,
      snapshot.advertiserId,
      snapshot.itemId,
      snapshot.status,
      snapshot.dateFrom,
      snapshot.dateTo,
      snapshot.observedAt,
      snapshot.sourceHash,
      JSON.stringify(snapshot),
    ],
  );
}
