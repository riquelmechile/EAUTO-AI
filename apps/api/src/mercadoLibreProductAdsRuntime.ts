import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { MercadoLibreProductAdsService } from "@eauto/application";
import {
  MercadoLibreHttpClient,
  MercadoLibreProductAdsHttpReader,
  NodeMercadoLibreSecurity,
  PostgresMercadoLibreConnectionRepository,
  PostgresMercadoLibreProductAdsRepository,
  RotatingMercadoLibreQuestionAnswerCredentialProvider,
} from "@eauto/infrastructure";
import type { AppConfig } from "./config.js";

export function createMercadoLibreProductAdsRuntime(
  config: AppConfig,
  pool: Pool | null,
  clock: { now(): Date },
): MercadoLibreProductAdsService | null {
  if (!config.MELI_PRODUCT_ADS_ENABLED) return null;
  if (
    !pool ||
    !config.MELI_CLIENT_ID ||
    !config.MELI_CLIENT_SECRET ||
    !config.MELI_REDIRECT_URI ||
    !config.MELI_TOKEN_VAULT_KEY_BASE64 ||
    !config.MELI_PRODUCT_ADS_ACCOUNT_ID
  ) {
    throw new Error("MercadoLibre Product Ads runtime is enabled but incomplete.");
  }
  const expectedAdvertiserIds = parseAdvertiserIds(config.MELI_PRODUCT_ADS_ADVERTISER_IDS_JSON);
  const connections = new PostgresMercadoLibreConnectionRepository(pool);
  const repository = new PostgresMercadoLibreProductAdsRepository(pool);
  const security = new NodeMercadoLibreSecurity(config.MELI_TOKEN_VAULT_KEY_BASE64);
  const client = new MercadoLibreHttpClient({
    clientId: config.MELI_CLIENT_ID,
    clientSecret: config.MELI_CLIENT_SECRET,
    redirectUri: config.MELI_REDIRECT_URI,
    tokenUrl: config.MELI_TOKEN_URL,
    apiBaseUrl: config.MELI_API_BASE_URL,
    timeoutMs: config.MELI_HTTP_TIMEOUT_MS,
    maximumScanPages: config.MELI_MAXIMUM_SCAN_PAGES,
  });
  const credentials = new RotatingMercadoLibreQuestionAnswerCredentialProvider(
    connections,
    security,
    client,
    clock,
    {
      allowedAccountId: config.MELI_PRODUCT_ADS_ACCOUNT_ID,
      refreshWindowMs: config.MELI_REFRESH_WINDOW_MS,
      refreshLeaseMs: config.MELI_REFRESH_LEASE_MS,
    },
  );
  return new MercadoLibreProductAdsService(
    credentials,
    new MercadoLibreProductAdsHttpReader({
      apiBaseUrl: config.MELI_API_BASE_URL,
      timeoutMs: config.MELI_PRODUCT_ADS_TIMEOUT_MS,
      maximumResponseBytes: config.MELI_PRODUCT_ADS_MAX_RESPONSE_BYTES,
      maximumScanPages: config.MELI_MAXIMUM_SCAN_PAGES,
    }),
    repository,
    connections,
    repository,
    clock,
    (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex"),
    {
      expectedAdvertiserIds,
      maximumRangeDays: config.MELI_PRODUCT_ADS_MAXIMUM_RANGE_DAYS,
    },
  );
}

function parseAdvertiserIds(value: string): Readonly<Record<string, string>> {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("MELI_PRODUCT_ADS_ADVERTISER_IDS_JSON must contain an object.");
  }
  const result: Record<string, string> = {};
  for (const [accountId, advertiserId] of Object.entries(parsed)) {
    if (!accountId.trim() || typeof advertiserId !== "string" || !/^\d+$/.test(advertiserId)) {
      throw new Error("Product Ads advertiser mapping must use account IDs and numeric IDs.");
    }
    result[accountId] = advertiserId;
  }
  return Object.freeze(result);
}
