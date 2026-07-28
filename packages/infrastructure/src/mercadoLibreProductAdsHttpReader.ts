import { createHash } from "node:crypto";
import {
  MercadoLibreRemoteError,
  type MercadoLibreProductAdsAdvertiser,
  type MercadoLibreProductAdsReader,
  type MercadoLibreRemoteProductAdsAdGroup,
  type MercadoLibreRemoteProductAdsCampaign,
  type MercadoLibreRemoteProductAdsItem,
} from "@eauto/application";
import type { MercadoLibreProductAdsMetrics } from "@eauto/domain";

const PRODUCT_ADS_METRICS = [
  "clicks",
  "prints",
  "cost",
  "cpc",
  "direct_amount",
  "indirect_amount",
  "total_amount",
  "direct_units_quantity",
  "indirect_units_quantity",
  "units_quantity",
  "direct_items_quantity",
  "indirect_items_quantity",
  "advertising_items_quantity",
  "organic_units_quantity",
  "organic_amount",
  "organic_items_quantity",
  "ctr",
  "cvr",
  "acos",
  "tacos",
  "roas",
  "sov",
].join(",");

export type MercadoLibreProductAdsHttpReaderConfig = Readonly<{
  apiBaseUrl: string;
  timeoutMs: number;
  maximumResponseBytes: number;
  maximumScanPages: number;
}>;

export class MercadoLibreProductAdsHttpReader implements MercadoLibreProductAdsReader {
  private readonly apiBaseUrl: URL;

  constructor(private readonly config: MercadoLibreProductAdsHttpReaderConfig) {
    this.apiBaseUrl = validateApiBaseUrl(config.apiBaseUrl);
    if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1_000) {
      throw new Error("Product Ads timeout must be at least 1000 ms.");
    }
    if (!Number.isSafeInteger(config.maximumResponseBytes) || config.maximumResponseBytes < 1_024) {
      throw new Error("Product Ads response limit must be at least 1024 bytes.");
    }
    if (!Number.isSafeInteger(config.maximumScanPages) || config.maximumScanPages < 1) {
      throw new Error("Product Ads maximum scan pages must be a positive safe integer.");
    }
  }

  async listAdvertisers(
    accessToken: string,
  ): Promise<readonly MercadoLibreProductAdsAdvertiser[]> {
    const payload = await this.getJson(
      "/advertising/advertisers?product_id=PADS",
      accessToken,
      "1",
    );
    const rawAdvertisers = Array.isArray(payload)
      ? payload
      : readArray(asRecord(payload, "Product Ads advertisers"), ["advertisers", "results"]);
    return Object.freeze(
      rawAdvertisers.map((value) => {
        const advertiser = asRecord(value, "Product Ads advertiser");
        return Object.freeze({
          advertiserId: readStringOrNumber(advertiser, ["advertiser_id", "id"]),
          siteId: readString(advertiser, ["site_id"]),
          advertiserName: readString(advertiser, ["advertiser_name", "name"]),
          accountName: readString(advertiser, ["account_name", "account"]),
        });
      }),
    );
  }

  async read(input: {
    advertiserId: string;
    siteId: "MLC";
    dateFrom: string;
    dateTo: string;
    accessToken: string;
  }): Promise<{
    campaigns: readonly MercadoLibreRemoteProductAdsCampaign[];
    adGroups: readonly MercadoLibreRemoteProductAdsAdGroup[];
    items: readonly MercadoLibreRemoteProductAdsItem[];
  }> {
    const campaigns = await this.listCampaigns(input);
    const adGroups: MercadoLibreRemoteProductAdsAdGroup[] = [];
    const items: MercadoLibreRemoteProductAdsItem[] = [];
    for (const campaign of campaigns) {
      const campaignAdGroups = await this.listAdGroups({ ...input, campaignId: campaign.campaignId });
      adGroups.push(...campaignAdGroups);
      for (const adGroup of campaignAdGroups) {
        items.push(...(await this.listAdGroupItems({ ...input, campaignId: campaign.campaignId, adGroupId: adGroup.adGroupId })));
      }
    }
    return Object.freeze({
      campaigns,
      adGroups: Object.freeze(adGroups),
      items: Object.freeze(items),
    });
  }

  private async listCampaigns(input: {
    advertiserId: string;
    siteId: "MLC";
    dateFrom: string;
    dateTo: string;
    accessToken: string;
  }): Promise<readonly MercadoLibreRemoteProductAdsCampaign[]> {
    const campaigns: MercadoLibreRemoteProductAdsCampaign[] = [];
    const limit = 50;
    for (let page = 0; page < this.config.maximumScanPages; page += 1) {
      const offset = page * limit;
      const query = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
        date_from: input.dateFrom,
        date_to: input.dateTo,
        metrics: PRODUCT_ADS_METRICS,
        metrics_summary: "true",
      });
      const payload = asRecord(
        await this.getJson(
          `/advertising/${input.siteId}/advertisers/${encodeURIComponent(input.advertiserId)}/product_ads/campaigns/search?${query}`,
          input.accessToken,
          "2",
        ),
        "Product Ads campaign search",
      );
      const results = readArray(payload, ["results", "campaigns"]);
      for (const value of results) {
        const campaign = asRecord(value, "Product Ads campaign");
        const strategy = readOptionalString(campaign, ["strategy"]);
        const normalized = {
          advertiserId: input.advertiserId,
          siteId: input.siteId,
          campaignId: readStringOrNumber(campaign, ["id", "campaign_id"]),
          name: readString(campaign, ["name"]),
          status: readString(campaign, ["status"]),
          ...(strategy ? { strategy } : {}),
          ...optionalMoney(campaign, "dailyBudgetMinor", ["daily_budget", "budget"]),
          ...optionalNumberProperty(campaign, "roasTarget", ["roas_target"]),
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
          metrics: normalizeMetrics(readMetricsRecord(campaign)),
        };
        campaigns.push(Object.freeze({ ...normalized, sourceHash: hashPayload(normalized) }));
      }
      const total = readPagingTotal(payload, offset + results.length);
      if (results.length < limit || offset + results.length >= total) break;
    }
    return Object.freeze(campaigns);
  }

  private async listAdGroups(input: {
    advertiserId: string;
    siteId: "MLC";
    campaignId: string;
    dateFrom: string;
    dateTo: string;
    accessToken: string;
  }): Promise<readonly MercadoLibreRemoteProductAdsAdGroup[]> {
    const query = new URLSearchParams({
      date_from: input.dateFrom,
      date_to: input.dateTo,
      metrics: PRODUCT_ADS_METRICS,
    });
    const payload = await this.getJson(
      `/advertising/${input.siteId}/product_ads/campaigns/${encodeURIComponent(input.campaignId)}/ad_groups/metrics?${query}`,
      input.accessToken,
      "2",
    );
    const results = Array.isArray(payload)
      ? payload
      : readArray(asRecord(payload, "Product Ads Ad Group metrics"), ["results", "ad_groups"]);
    return Object.freeze(
      results.map((value) => {
        const adGroup = asRecord(value, "Product Ads Ad Group");
        const externalId = readOptionalStringOrNumber(adGroup, [
          "ad_group_external_id",
          "external_id",
        ]);
        const type = readOptionalString(adGroup, ["type"]);
        const status = readOptionalString(adGroup, ["status"]);
        const normalized = {
          advertiserId: input.advertiserId,
          siteId: input.siteId,
          campaignId: input.campaignId,
          adGroupId: readStringOrNumber(adGroup, ["ad_group_id", "id"]),
          ...(externalId ? { externalId } : {}),
          ...(type ? { type } : {}),
          ...(status ? { status } : {}),
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
          metrics: normalizeMetrics(readMetricsRecord(adGroup)),
        };
        return Object.freeze({ ...normalized, sourceHash: hashPayload(normalized) });
      }),
    );
  }

  private async listAdGroupItems(input: {
    advertiserId: string;
    siteId: "MLC";
    campaignId: string;
    adGroupId: string;
    dateFrom: string;
    dateTo: string;
    accessToken: string;
  }): Promise<readonly MercadoLibreRemoteProductAdsItem[]> {
    const items: MercadoLibreRemoteProductAdsItem[] = [];
    const limit = 50;
    for (let page = 0; page < this.config.maximumScanPages; page += 1) {
      const offset = page * limit;
      const query = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
        date_from: input.dateFrom,
        date_to: input.dateTo,
        metrics: PRODUCT_ADS_METRICS,
      });
      const payload = asRecord(
        await this.getJson(
          `/advertising/${input.siteId}/product_ads/ad_groups/${encodeURIComponent(input.adGroupId)}/ads?${query}`,
          input.accessToken,
          "2",
        ),
        "Product Ads item search",
      );
      const results = readArray(payload, ["results", "ads", "items"]);
      for (const value of results) {
        const item = asRecord(value, "Product Ads item");
        const title = readOptionalString(item, ["title"]);
        const price = readOptionalNumber(item, ["price"]);
        const metricsRecord = readOptionalMetricsRecord(item);
        const normalized = {
          advertiserId: input.advertiserId,
          siteId: input.siteId,
          campaignId: input.campaignId,
          adGroupId: input.adGroupId,
          itemId: readStringOrNumber(item, ["item_id", "ad_group_external_id", "external_id", "id"]),
          ...(title ? { title } : {}),
          status: readString(item, ["status"]),
          ...(price === undefined ? {} : { priceMinor: toClpMinor(price) }),
          metrics: metricsRecord ? normalizeMetrics(metricsRecord) : null,
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
        };
        items.push(Object.freeze({ ...normalized, sourceHash: hashPayload(normalized) }));
      }
      const total = readPagingTotal(payload, offset + results.length);
      if (results.length < limit || offset + results.length >= total) break;
    }
    return Object.freeze(items);
  }

  private async getJson(path: string, accessToken: string, apiVersion: "1" | "2"): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(new URL(path, this.apiBaseUrl), {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
          "api-version": apiVersion,
        },
        redirect: "error",
        signal: controller.signal,
      });
      const text = await readLimitedText(response, this.config.maximumResponseBytes);
      if (!response.ok) {
        throw new MercadoLibreRemoteError(
          `MercadoLibre Product Ads read failed (${response.status}) for ${path}: ${sanitize(text)}`,
          response.status === 401,
        );
      }
      if (!text) throw new Error("MercadoLibre Product Ads response was empty.");
      try {
        return JSON.parse(text) as unknown;
      } catch (error) {
        throw new Error("MercadoLibre Product Ads response was not valid JSON.", { cause: error });
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`MercadoLibre Product Ads request timed out after ${this.config.timeoutMs} ms.`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeMetrics(metrics: Record<string, unknown>): MercadoLibreProductAdsMetrics {
  return Object.freeze({
    clicks: readNonNegativeInteger(metrics, ["clicks"]),
    prints: readNonNegativeInteger(metrics, ["prints", "impressions"]),
    costMinor: toClpMinor(readNonNegativeNumber(metrics, ["cost"])),
    cpcMinor: toClpMinor(readNonNegativeNumber(metrics, ["cpc"])),
    directAmountMinor: toClpMinor(readNonNegativeNumber(metrics, ["direct_amount"])),
    indirectAmountMinor: toClpMinor(readNonNegativeNumber(metrics, ["indirect_amount"])),
    totalAmountMinor: toClpMinor(readNonNegativeNumber(metrics, ["total_amount"])),
    directUnitsQuantity: readNonNegativeInteger(metrics, ["direct_units_quantity"]),
    indirectUnitsQuantity: readNonNegativeInteger(metrics, ["indirect_units_quantity"]),
    unitsQuantity: readNonNegativeInteger(metrics, ["units_quantity"]),
    directItemsQuantity: readNonNegativeInteger(metrics, ["direct_items_quantity"]),
    indirectItemsQuantity: readNonNegativeInteger(metrics, ["indirect_items_quantity"]),
    advertisingItemsQuantity: readNonNegativeInteger(metrics, ["advertising_items_quantity"]),
    organicUnitsQuantity: readNonNegativeInteger(metrics, ["organic_units_quantity"]),
    organicAmountMinor: toClpMinor(readNonNegativeNumber(metrics, ["organic_amount"])),
    organicItemsQuantity: readNonNegativeInteger(metrics, ["organic_items_quantity"]),
    ctr: readNonNegativeNumber(metrics, ["ctr"]),
    cvr: readNonNegativeNumber(metrics, ["cvr"]),
    acos: readNonNegativeNumber(metrics, ["acos"]),
    tacos: readNonNegativeNumber(metrics, ["tacos"]),
    roas: readNonNegativeNumber(metrics, ["roas"]),
    sov: readNonNegativeNumber(metrics, ["sov"]),
  });
}

function readMetricsRecord(value: Record<string, unknown>): Record<string, unknown> {
  return readOptionalMetricsRecord(value) ?? value;
}

function readOptionalMetricsRecord(value: Record<string, unknown>): Record<string, unknown> | null {
  for (const field of ["metrics", "metrics_summary"]) {
    const candidate = value[field];
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate as Record<string, unknown>;
    }
  }
  if (["clicks", "prints", "cost", "total_amount"].some((field) => field in value)) return value;
  return null;
}

function optionalMoney(
  record: Record<string, unknown>,
  property: "dailyBudgetMinor",
  fields: readonly string[],
): { dailyBudgetMinor?: number } {
  const value = readOptionalNumber(record, fields);
  return value === undefined ? {} : { [property]: toClpMinor(value) };
}

function optionalNumberProperty(
  record: Record<string, unknown>,
  property: "roasTarget",
  fields: readonly string[],
): { roasTarget?: number } {
  const value = readOptionalNumber(record, fields);
  return value === undefined ? {} : { [property]: value };
}

function validateApiBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "api.mercadolibre.com" || url.username || url.password || url.search || url.hash) {
    throw new Error("Product Ads API must use https://api.mercadolibre.com.");
  }
  return new URL("/", url);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readArray(record: Record<string, unknown>, fields: readonly string[]): readonly unknown[] {
  for (const field of fields) {
    const value = record[field];
    if (Array.isArray(value)) return value;
  }
  throw new Error(`${fields.join(" or ")} must be an array.`);
}

function readString(record: Record<string, unknown>, fields: readonly string[]): string {
  const value = readOptionalString(record, fields);
  if (!value) throw new Error(`${fields.join(" or ")} must be a non-empty string.`);
  return value;
}

function readOptionalString(record: Record<string, unknown>, fields: readonly string[]): string | undefined {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function readStringOrNumber(record: Record<string, unknown>, fields: readonly string[]): string {
  const value = readOptionalStringOrNumber(record, fields);
  if (!value) throw new Error(`${fields.join(" or ")} must be a string or safe integer.`);
  return value;
}

function readOptionalStringOrNumber(
  record: Record<string, unknown>,
  fields: readonly string[],
): string | undefined {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  }
  return undefined;
}

function readOptionalNumber(record: Record<string, unknown>, fields: readonly string[]): number | undefined {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}

function readNonNegativeNumber(record: Record<string, unknown>, fields: readonly string[]): number {
  return readOptionalNumber(record, fields) ?? 0;
}

function readNonNegativeInteger(record: Record<string, unknown>, fields: readonly string[]): number {
  const value = readNonNegativeNumber(record, fields);
  if (!Number.isSafeInteger(value)) throw new Error(`${fields.join(" or ")} must be a safe integer.`);
  return value;
}

function readPagingTotal(payload: Record<string, unknown>, fallback: number): number {
  const paging = payload.paging;
  if (paging && typeof paging === "object" && !Array.isArray(paging)) {
    const total = readOptionalNumber(paging as Record<string, unknown>, ["total"]);
    if (total !== undefined && Number.isSafeInteger(total)) return total;
  }
  const total = readOptionalNumber(payload, ["total"]);
  return total !== undefined && Number.isSafeInteger(total) ? total : fallback;
}

function toClpMinor(value: number): number {
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded) || rounded < 0) {
    throw new Error("Product Ads CLP amount exceeded the safe integer range.");
  }
  return rounded;
}

async function readLimitedText(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error(`Product Ads response exceeds ${maximumBytes} bytes.`);
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > maximumBytes) {
    throw new Error(`Product Ads response exceeds ${maximumBytes} bytes.`);
  }
  return new TextDecoder().decode(buffer);
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sanitize(value: string): string {
  return value.replaceAll(/[\r\n\t]+/g, " ").slice(0, 500);
}
