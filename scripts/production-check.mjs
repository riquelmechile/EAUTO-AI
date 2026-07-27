import { spawnSync } from "node:child_process";

const productionArguments = process.argv.slice(2);
const checks = [
  ["scripts/production-doctor.mjs", ...productionArguments],
  ["scripts/release-doctor.mjs"],
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
