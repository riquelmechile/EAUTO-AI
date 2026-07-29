import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../apps/api/dist/config.js";
import { createCompanyIntelligenceRuntime } from "../apps/api/dist/companyIntelligenceRuntime.js";
import { createOperationalIntelligenceRuntime } from "../apps/api/dist/operationalIntelligenceRuntime.js";
import { createRuntime } from "../apps/api/dist/runtime.js";

const compose = [
  "compose",
  "-p",
  "eauto-postgres-smoke",
  "-f",
  "infra/compose/docker-compose.yml",
];
const databaseUrl = "postgres://eauto:eauto@127.0.0.1:5432/eauto";
let runtime = null;
let operationalRuntime = null;
let companyRuntime = null;
let stage = "initialize";

try {
  stage = "start-postgres";
  run("docker", [...compose, "up", "-d", "postgres"]);
  stage = "wait-for-postgres";
  await waitForPostgres();
  stage = "apply-migrations";
  run("node", ["scripts/migrate.mjs"], { DATABASE_URL: databaseUrl });
  stage = "verify-postgres-schema";
  run("node", ["scripts/smoke-postgres-schema.mjs"], { DATABASE_URL: databaseUrl });
  stage = "verify-profit-engine";
  run("node", ["scripts/smoke-profit-engine-postgres.mjs"], { DATABASE_URL: databaseUrl });
  stage = "verify-supplier-mirror";
  run("node", ["scripts/smoke-supplier-mirror-postgres.mjs"], { DATABASE_URL: databaseUrl });
  stage = "verify-supplier-authority";
  run("node", ["scripts/smoke-supplier-authority-postgres.mjs"], {
    DATABASE_URL: databaseUrl,
  });
  stage = "verify-supplier-sync-invariants";
  run("node", ["scripts/smoke-supplier-sync-invariants-postgres.mjs"], {
    DATABASE_URL: databaseUrl,
  });
  stage = "verify-supplier-cost-feed";
  run("node", ["scripts/smoke-supplier-cost-feed-postgres.mjs"], {
    DATABASE_URL: databaseUrl,
  });
  stage = "verify-product-identification";
  run("node", ["scripts/smoke-product-identification-postgres.mjs"], {
    DATABASE_URL: databaseUrl,
  });
  stage = "verify-catalog-acquisition";
  run("node", ["scripts/smoke-catalog-acquisition-postgres.mjs"], {
    DATABASE_URL: databaseUrl,
  });
  stage = "verify-mercadolibre-taxonomy-snapshots";
  run("node", ["scripts/smoke-mercadolibre-taxonomy-postgres.mjs"], {
    DATABASE_URL: databaseUrl,
  });
  stage = "verify-mercadolibre-product-ads";
  run("node", ["scripts/smoke-mercadolibre-product-ads-postgres.mjs"], {
    DATABASE_URL: databaseUrl,
  });
  stage = "verify-gentleman-parity";
  run("node", ["scripts/smoke-gentleman-parity-postgres.mjs"], {
    DATABASE_URL: databaseUrl,
  });
  stage = "verify-migration-idempotency";
  run("node", ["scripts/migrate.mjs"], { DATABASE_URL: databaseUrl });

  stage = "parse-production-template";
  const template = parseEnvironment(
    await readFile(new URL("../.env.production.example", import.meta.url), "utf8"),
  );
  const smokeEnvironment = {
    ...template,
    NODE_ENV: "production",
    POSTGRES_PASSWORD: "eauto",
    DATABASE_URL: databaseUrl,
    MINIO_ROOT_USER: "minio-smoke-user",
    MINIO_ROOT_PASSWORD: "minio-smoke-password",
    OBJECT_STORAGE_ACCESS_KEY: "minio-smoke-user",
    OBJECT_STORAGE_SECRET_KEY: "minio-smoke-password",
    OPERATOR_TOKENS_JSON: JSON.stringify([
      {
        id: "production-smoke-owner",
        tokenHash: "a".repeat(64),
        organizationId: "maustian",
        roles: ["owner"],
        accountIds: ["plasticov", "maustian"],
      },
    ]),
    CONTENT_PROVIDER_API_KEY: "content-smoke-key",
    CATALOG_VISUAL_PROVIDER_API_KEY: "catalog-visual-smoke-key",
    PRODUCT_FINGERPRINT_PROVIDER_API_KEY: "fingerprint-smoke-key",
    CATALOG_SUPPLIER_API_KEY: "catalog-supplier-smoke-key",
    LLM_API_KEY: "llm-smoke-key",
    MELI_CLIENT_ID: "meli-smoke-client",
    MELI_CLIENT_SECRET: "meli-smoke-secret",
    MELI_TOKEN_VAULT_KEY_BASE64: Buffer.alloc(32, 7).toString("base64"),
    MELI_PLASTICOV_SELLER_ID: "100001",
    MELI_MAUSTIAN_SELLER_ID: "100002",
    MELI_APPLICATION_ID: "100003",
    MELI_WEBHOOK_TOKEN: "smoke-webhook-token-0123456789abcdef",
    MELI_QUESTION_ANSWER_ENABLED: "true",
    MELI_QUESTION_ANSWER_ACCOUNT_ID: "plasticov",
  };
  const config = loadConfig(smokeEnvironment);

  stage = "create-production-runtime";
  runtime = await createRuntime(config);
  operationalRuntime = createOperationalIntelligenceRuntime(runtime, config);
  companyRuntime = createCompanyIntelligenceRuntime(
    runtime,
    operationalRuntime,
    config,
    smokeEnvironment,
  );
  await companyRuntime.initialize();
  assert(runtime.persistenceMode === "postgres", "production runtime must use Postgres");
  assert(
    runtime.contentGenerationMode === "deterministic",
    "legacy generic content gateway must remain disabled",
  );
  assert(companyRuntime.creativeStudio !== null, "MiniMax Creative Studio must be wired separately");
  assert(companyRuntime.economic !== null, "economic operations require PostgreSQL wiring");
  assert(companyRuntime.enabled, "company intelligence worker must be enabled");
  assert(
    (
      await companyRuntime.daemons.listStates({
        organizationId: "maustian",
        accountId: "plasticov",
      })
    ).length === 16,
    "Plasticov must initialize exactly sixteen specialist daemons",
  );
  assert(
    runtime.catalogAcquisitionMode === "external",
    "catalog acquisition providers must be external",
  );
  assert(
    runtime.catalogAcquisitionPolicy.supplierSourceIds.includes("supplier-production"),
    "catalog acquisition policy must use configured supplier routes",
  );
  assert(
    runtime.productIdentificationMode === "catalog-visual-external",
    "product identification must use the allowlisted catalog visual provider",
  );
  assert(
    runtime.productFingerprintMode === "external-phash-64",
    "product identification must use the allowlisted perceptual fingerprint provider",
  );
  assert(
    runtime.productIdentificationPolicy.policyVersion.endsWith(":product-identification-v1"),
    "product identification policy must be server-owned and versioned",
  );
  assert(
    runtime.actionExecutionMode === "mercadolibre-question-answer",
    "only the dedicated MercadoLibre question answer executor may be enabled",
  );
  assert(runtime.shadowLlm !== null, "DeepSeek shadow runtime must be enabled");
  assert(runtime.mercadoLibre !== null, "MercadoLibre Chile runtime must be enabled");
  assert(runtime.mercadoLibreProductAds !== null, "Product Ads v2 runtime must be enabled");
  assert(
    runtime.mercadoLibreNotificationIngestion !== null,
    "MercadoLibre webhook ingestion must be enabled",
  );
  assert(
    runtime.mercadoLibreNotificationProcessor !== null,
    "MercadoLibre webhook processor must be enabled",
  );
  console.log("✓ Fresh PostgreSQL migrations applied and idempotent");
  console.log("✓ Scoped repositories and action lifecycle verified");
  console.log("✓ Profit Engine persistence and margin-audit leases verified");
  console.log("✓ Supplier Mirror ingestion, debounce and stock-risk leases verified");
  console.log("✓ Multi-provider supplier authority and lease isolation verified");
  console.log("✓ Failed sync preservation and monotonic supplier state verified");
  console.log("✓ Verified supplier product cost feeds Profit Engine");
  console.log("✓ Product identification, human review and safe fingerprint semantics verified");
  console.log("✓ Product identification runtime and server-owned policy wired");
  console.log("✓ External perceptual fingerprint gateway required and wired");
  console.log("✓ Catalog acquisition persistence and review lifecycle verified");
  console.log("✓ MercadoLibre taxonomy snapshot versions and scope verified");
  console.log("✓ Product Ads snapshots, reconciliation and tenant isolation verified");
  console.log("✓ Agent bus, Evidence Router, semantic memory and Account Brain verified");
  console.log("✓ Sixteen specialist daemons, supply workflows and lifecycle BI verified");
  console.log("✓ Economic CLI persistence contract verified");
  console.log("✓ MiniMax Creative Studio wired with private object storage");
  console.log("✓ Production configuration parsed");
  console.log("✓ Generic marketplace writes disabled and question.answer wired explicitly");
  console.log("✓ Product Ads v2 read plane and reconciliation runtime wired");
  console.log("✓ External providers and MercadoLibre runtimes wired");
  console.log("EAUTO_PRODUCTION_SMOKE_OK");
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown production smoke failure";
  console.error(
    `EAUTO_PRODUCTION_SMOKE_FAILURE stage=${stage} message=${message.replace(/[\r\n\t]+/g, " ").slice(0, 1_000)}`,
  );
  throw error;
} finally {
  await companyRuntime?.close();
  await operationalRuntime?.close();
  await runtime?.close();
  run("docker", [...compose, "down", "--volumes", "--remove-orphans"], {}, true);
}

async function waitForPostgres() {
  let consecutiveSuccessfulQueries = 0;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = spawnSync(
      "docker",
      [
        ...compose,
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        "eauto",
        "-d",
        "eauto",
        "-v",
        "ON_ERROR_STOP=1",
        "-Atqc",
        "SELECT 1",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const querySucceeded = result.status === 0 && result.stdout.trim() === "1";
    consecutiveSuccessfulQueries = querySucceeded ? consecutiveSuccessfulQueries + 1 : 0;
    if (consecutiveSuccessfulQueries >= 3) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("PostgreSQL did not reach three consecutive stable SQL checks.");
}

function run(command, args, extraEnvironment = {}, allowFailure = false) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "inherit",
    env: { ...process.env, ...extraEnvironment },
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${String(result.status)}.`);
  }
}

function parseEnvironment(content) {
  const result = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    result[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
