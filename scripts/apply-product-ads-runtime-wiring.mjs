import { readFile, writeFile } from "node:fs/promises";

await replaceOnce(
  "apps/api/src/config.ts",
  "  MELI_MAXIMUM_SCAN_PAGES: z.coerce.number().int().min(1).max(1_000).default(100),\n  MELI_QUESTION_ANSWER_ENABLED:",
  `  MELI_MAXIMUM_SCAN_PAGES: z.coerce.number().int().min(1).max(1_000).default(100),
  MELI_PRODUCT_ADS_ENABLED: environmentBoolean.default(false),
  MELI_PRODUCT_ADS_ACCOUNT_ID: optionalString,
  MELI_PRODUCT_ADS_ADVERTISER_IDS_JSON: z.string().default("{}"),
  MELI_PRODUCT_ADS_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  MELI_PRODUCT_ADS_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(20_000_000)
    .default(2_000_000),
  MELI_PRODUCT_ADS_MAXIMUM_RANGE_DAYS: z.coerce.number().int().min(1).max(90).default(90),
  MELI_QUESTION_ANSWER_ENABLED:`,
);

await replaceOnce(
  "apps/api/src/config.ts",
  "function validateMercadoLibreConfig(config: z.infer<typeof configSchema>): void {\n  if (config.MELI_QUESTION_ANSWER_ENABLED) {",
  `function validateMercadoLibreConfig(config: z.infer<typeof configSchema>): void {
  if (config.MELI_PRODUCT_ADS_ENABLED) {
    if (!config.MELI_ENABLED || !config.DATABASE_URL) {
      throw new Error(
        "MELI_PRODUCT_ADS_ENABLED requires MELI_ENABLED and durable PostgreSQL storage.",
      );
    }
    if (config.MELI_PRODUCT_ADS_ACCOUNT_ID !== "plasticov") {
      throw new Error("The first Product Ads rollout is restricted to the Plasticov account.");
    }
    let mappings: unknown;
    try {
      mappings = JSON.parse(config.MELI_PRODUCT_ADS_ADVERTISER_IDS_JSON);
    } catch {
      throw new Error("MELI_PRODUCT_ADS_ADVERTISER_IDS_JSON must contain valid JSON.");
    }
    if (!isRecord(mappings)) {
      throw new Error("MELI_PRODUCT_ADS_ADVERTISER_IDS_JSON must contain an object.");
    }
    for (const [accountId, advertiserId] of Object.entries(mappings)) {
      if (!accountId.trim() || typeof advertiserId !== "string" || !/^\\d+$/.test(advertiserId)) {
        throw new Error("Product Ads advertiser mapping must use account IDs and numeric IDs.");
      }
    }
  }
  if (config.MELI_QUESTION_ANSWER_ENABLED) {`,
);

await replaceOnce(
  "apps/api/src/runtime.ts",
  'import type { AppConfig } from "./config.js";\n',
  'import type { AppConfig } from "./config.js";\nimport { createMercadoLibreProductAdsRuntime } from "./mercadoLibreProductAdsRuntime.js";\n',
);

await replaceOnce(
  "apps/api/src/runtime.ts",
  "  const mercadoLibre = createMercadoLibreRuntime(config, pool, clock);\n  const mercadoLibreNotifications =",
  "  const mercadoLibre = createMercadoLibreRuntime(config, pool, clock);\n  const mercadoLibreProductAds = createMercadoLibreProductAdsRuntime(config, pool, clock);\n  const mercadoLibreNotifications =",
);

await replaceOnce(
  "apps/api/src/runtime.ts",
  "    mercadoLibre,\n    mercadoLibreNotifications,",
  "    mercadoLibre,\n    mercadoLibreProductAds,\n    mercadoLibreNotifications,",
);

await replaceOnce(
  "apps/api/src/app.ts",
  'import { registerMercadoLibreRoutes } from "./mercadoLibreRoutes.js";\n',
  'import { registerMercadoLibreRoutes } from "./mercadoLibreRoutes.js";\nimport { registerMercadoLibreProductAdsRoutes } from "./mercadoLibreProductAdsRoutes.js";\n',
);

await replaceOnce(
  "apps/api/src/app.ts",
  `  registerAgentOsRoutes(app, {`,
  `  registerMercadoLibreProductAdsRoutes(app, {
    runtime,
    authenticate: (request) => authenticate(request, runtime, authenticator),
    requireAccount: async (actor, accountId, permission) => {
      await requireAccount(runtime, actor, accountId, permission);
    },
  });

  registerAgentOsRoutes(app, {`,
);

await replaceOnce(
  ".env.production.example",
  `# First and only scoped MercadoLibre write. Enable only after issue #41 live gates.`,
  `# MercadoLibre Product Ads v2 read plane. Sync requires an explicit date range.
MELI_PRODUCT_ADS_ENABLED=true
MELI_PRODUCT_ADS_ACCOUNT_ID=plasticov
# Leave empty to auto-select only when exactly one MLC advertiser is visible.
MELI_PRODUCT_ADS_ADVERTISER_IDS_JSON={}
MELI_PRODUCT_ADS_TIMEOUT_MS=30000
MELI_PRODUCT_ADS_MAX_RESPONSE_BYTES=2000000
MELI_PRODUCT_ADS_MAXIMUM_RANGE_DAYS=90

# First and only scoped MercadoLibre write. Enable only after issue #41 live gates.`,
);

await replaceOnce(
  "scripts/smoke-production-runtime.mjs",
  '  assert(runtime.mercadoLibre !== null, "MercadoLibre Chile runtime must be enabled");\n',
  '  assert(runtime.mercadoLibre !== null, "MercadoLibre Chile runtime must be enabled");\n  assert(runtime.mercadoLibreProductAds !== null, "Product Ads v2 runtime must be enabled");\n',
);

await replaceOnce(
  "scripts/smoke-production-runtime.mjs",
  '  console.log("✓ External providers and MercadoLibre runtimes wired");\n',
  '  console.log("✓ Product Ads v2 read plane and reconciliation runtime wired");\n  console.log("✓ External providers and MercadoLibre runtimes wired");\n',
);

await replaceOnce(
  "package.json",
  '    "smoke:mercadolibre-question-answer": "node scripts/smoke-mercadolibre-question-answer-contract.mjs"\n',
  '    "smoke:mercadolibre-question-answer": "node scripts/smoke-mercadolibre-question-answer-contract.mjs",\n    "smoke:mercadolibre-product-ads": "node scripts/smoke-mercadolibre-product-ads-postgres.mjs"\n',
);

async function replaceOnce(path, before, after) {
  const source = await readFile(path, "utf8");
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`Expected one match in ${path}; received ${count}.`);
  await writeFile(path, source.replace(before, after));
  console.log(`✓ ${path}`);
}
