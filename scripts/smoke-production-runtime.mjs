import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../apps/api/dist/config.js";
import { createRuntime } from "../apps/api/dist/runtime.js";

const compose = ["compose", "-p", "eauto-postgres-smoke", "-f", "infra/compose/docker-compose.yml"];
const databaseUrl = "postgres://eauto:eauto@127.0.0.1:5432/eauto";
let runtime = null;
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
  stage = "verify-migration-idempotency";
  run("node", ["scripts/migrate.mjs"], { DATABASE_URL: databaseUrl });

  stage = "parse-production-template";
  const template = parseEnvironment(
    await readFile(new URL("../.env.production.example", import.meta.url), "utf8"),
  );
  const config = loadConfig({
    ...template,
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
    ACTION_PROVIDER_API_KEY: "action-smoke-key",
    LLM_API_KEY: "llm-smoke-key",
    MELI_CLIENT_ID: "meli-smoke-client",
    MELI_CLIENT_SECRET: "meli-smoke-secret",
    MELI_TOKEN_VAULT_KEY_BASE64: Buffer.alloc(32, 7).toString("base64"),
    MELI_PLASTICOV_SELLER_ID: "100001",
    MELI_MAUSTIAN_SELLER_ID: "100002",
    MELI_APPLICATION_ID: "100003",
    MELI_WEBHOOK_TOKEN: "smoke-webhook-token-0123456789abcdef",
  });

  stage = "create-production-runtime";
  runtime = await createRuntime(config);
  assert(runtime.persistenceMode === "postgres", "production runtime must use Postgres");
  assert(runtime.contentGenerationMode === "external", "content provider must be external");
  assert(runtime.actionExecutionMode === "external", "action provider must be external");
  assert(runtime.shadowLlm !== null, "DeepSeek shadow runtime must be enabled");
  assert(runtime.mercadoLibre !== null, "MercadoLibre Chile runtime must be enabled");
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
  console.log("✓ Production configuration parsed");
  console.log("✓ External providers and MercadoLibre runtimes wired");
  console.log("EAUTO_PRODUCTION_SMOKE_OK");
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown production smoke failure";
  console.error(
    `EAUTO_PRODUCTION_SMOKE_FAILURE stage=${stage} message=${message.replace(/[\r\n\t]+/g, " ").slice(0, 1_000)}`,
  );
  throw error;
} finally {
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
