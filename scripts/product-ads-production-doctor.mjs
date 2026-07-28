import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const templateMode = process.argv.includes("--template");
const envArgument = process.argv.find((argument) => argument.startsWith("--env="));
const envPath = resolve(process.cwd(), envArgument?.slice(6) ?? ".env.production");
const configured = existsSync(envPath) ? parseEnvironment(await readFile(envPath, "utf8")) : {};
const requiredFiles = [
  "infra/postgres/migrations/031_mercadolibre_product_ads_read_plane.sql",
  "packages/domain/src/mercadoLibreProductAds.ts",
  "packages/application/src/mercadoLibreProductAdsService.ts",
  "packages/infrastructure/src/mercadoLibreProductAdsHttpReader.ts",
  "packages/infrastructure/src/mercadoLibreProductAdsRepositories.ts",
  "apps/api/src/mercadoLibreProductAdsRuntime.ts",
  "apps/api/src/mercadoLibreProductAdsRoutes.ts",
  "scripts/smoke-mercadolibre-product-ads-postgres.mjs",
  "docs/sdd/018-mercadolibre-product-ads-read-plane.md",
];
const failures = [];

for (const path of requiredFiles) {
  if (!existsSync(resolve(process.cwd(), path))) failures.push(`Missing Product Ads file: ${path}`);
}

if (configured.MELI_PRODUCT_ADS_ENABLED !== "true") {
  failures.push("MELI_PRODUCT_ADS_ENABLED must be true in the production template.");
}
if (configured.MELI_PRODUCT_ADS_ACCOUNT_ID !== "plasticov") {
  failures.push("MELI_PRODUCT_ADS_ACCOUNT_ID must be plasticov for the first rollout.");
}
validatePositiveInteger("MELI_PRODUCT_ADS_TIMEOUT_MS", 1_000, 120_000);
validatePositiveInteger("MELI_PRODUCT_ADS_MAX_RESPONSE_BYTES", 1_024, 20_000_000);
validatePositiveInteger("MELI_PRODUCT_ADS_MAXIMUM_RANGE_DAYS", 1, 90);
validateAdvertiserMappings();

for (const failure of failures) console.error(`✗ ${failure}`);
if (failures.length > 0) process.exitCode = 1;
else console.log("✓ Product Ads v2 production contract is complete and fail-closed");

function validatePositiveInteger(key, minimum, maximum) {
  const value = Number(configured[key]);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    failures.push(`${key} must be an integer between ${minimum} and ${maximum}.`);
  }
}

function validateAdvertiserMappings() {
  const raw = configured.MELI_PRODUCT_ADS_ADVERTISER_IDS_JSON;
  if (!raw) {
    failures.push("MELI_PRODUCT_ADS_ADVERTISER_IDS_JSON is required.");
    return;
  }
  try {
    const mappings = JSON.parse(raw);
    if (!mappings || typeof mappings !== "object" || Array.isArray(mappings)) {
      failures.push("MELI_PRODUCT_ADS_ADVERTISER_IDS_JSON must contain an object.");
      return;
    }
    for (const [accountId, advertiserId] of Object.entries(mappings)) {
      if (!accountId.trim() || typeof advertiserId !== "string" || !/^\d+$/.test(advertiserId)) {
        failures.push("Product Ads advertiser mappings require account IDs and numeric IDs.");
      }
    }
    if (!templateMode && Object.keys(mappings).length > 0 && !mappings.plasticov) {
      failures.push("A non-empty Product Ads mapping must include plasticov.");
    }
  } catch (error) {
    failures.push(`MELI_PRODUCT_ADS_ADVERTISER_IDS_JSON must be valid JSON: ${String(error)}`);
  }
}

function parseEnvironment(content) {
  const parsed = {};
  for (const line of content.split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith("#")) continue;
    const index = value.indexOf("=");
    if (index < 1) continue;
    parsed[value.slice(0, index).trim()] = unquote(value.slice(index + 1).trim());
  }
  return parsed;
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
