import { Pool } from "pg";
import { EconomicOperationsService, ProfitEngineService } from "@eauto/application";
import {
  PostgresEconomicOperationsRepository,
  PostgresProfitEngineRepository,
} from "@eauto/infrastructure";

const command = process.argv[2];
const options = parseOptions(process.argv.slice(3));
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (
  !command ||
  !new Set(["ingest", "status", "coverage", "reconcile", "missing", "inspect-evidence"]).has(
    command,
  )
) {
  throw new Error(
    "Usage: node scripts/economic.mjs <ingest|status|coverage|reconcile|missing|inspect-evidence> --account=<id> [--organization=maustian] [--listing=<id>] [--limit=1000]",
  );
}
const accountId = required(options.account, "--account");
const organizationId = options.organization ?? "maustian";
const listingId = options.listing;
const limit = options.limit ? positiveInteger(options.limit, "--limit") : undefined;
if (command === "inspect-evidence" && !listingId) {
  throw new Error("inspect-evidence requires --listing=<id>.");
}

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
try {
  const profitRepository = new PostgresProfitEngineRepository(pool);
  const service = new EconomicOperationsService(
    new PostgresEconomicOperationsRepository(pool),
    new ProfitEngineService(profitRepository, profitRepository, profitRepository),
  );
  const scope = { organizationId, accountId };
  const result =
    command === "status"
      ? await service.status(scope)
      : command === "coverage"
        ? await service.coverage({ ...scope, ...(limit ? { limit } : {}) })
        : command === "missing"
          ? await service.missing({ ...scope, ...(limit ? { limit } : {}) })
          : command === "inspect-evidence"
            ? await service.inspectEvidence({ ...scope, listingId })
            : command === "ingest"
              ? await service.ingest({
                  ...scope,
                  ...(listingId ? { listingId } : {}),
                  ...(limit ? { limit } : {}),
                })
              : await service.reconcile({
                  ...scope,
                  ...(listingId ? { listingId } : {}),
                  ...(limit ? { limit } : {}),
                });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await pool.end();
}

function parseOptions(values) {
  const result = {};
  for (const value of values) {
    if (!value.startsWith("--") || !value.includes("="))
      throw new Error(`Invalid option ${value}.`);
    const separator = value.indexOf("=");
    const key = value.slice(2, separator);
    const optionValue = value.slice(separator + 1).trim();
    if (!new Set(["organization", "account", "listing", "limit"]).has(key)) {
      throw new Error(`Unknown option --${key}.`);
    }
    if (!optionValue) throw new Error(`--${key} cannot be empty.`);
    result[key] = optionValue;
  }
  return result;
}

function required(value, label) {
  if (!value?.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 10_000) {
    throw new Error(`${label} must be an integer between 1 and 10000.`);
  }
  return parsed;
}
