import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const productionArguments = process.argv.slice(2);
const requiredProductIdentificationFiles = [
  "infra/postgres/migrations/028_product_identification_persistence.sql",
  "infra/postgres/migrations/029_product_identification_scope_and_similarity.sql",
  "infra/postgres/migrations/030_product_fingerprint_semantics.sql",
  "scripts/smoke-product-identification-postgres.mjs",
];

for (const path of requiredProductIdentificationFiles) {
  if (!existsSync(resolve(process.cwd(), path))) {
    console.error(`Missing required Product Identification production file ${path}.`);
    process.exit(1);
  }
}

const checks = [
  ["scripts/production-doctor.mjs", ...productionArguments],
  ["scripts/credentials-doctor.mjs", ...productionArguments],
  ["scripts/product-ads-production-doctor.mjs", ...productionArguments],
  ["scripts/gentleman-parity-doctor.mjs"],
  ["scripts/capability-parity-doctor.mjs"],
  ["scripts/release-doctor.mjs"],
  ["scripts/workflow-supply-chain-doctor.mjs"],
];

for (const arguments_ of checks) {
  const result = spawnSync(process.execPath, arguments_, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
