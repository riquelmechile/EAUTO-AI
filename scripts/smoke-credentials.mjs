import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "eauto-credentials-"));
const environmentPath = join(directory, ".env.production");
const operatorPath = `${environmentPath}.operator-token`;

try {
  run("node", [
    "scripts/generate-internal-secrets.mjs",
    `--output=${environmentPath}`,
    "--organization=maustian",
    "--operator=credential-smoke",
    "--accounts=plasticov,maustian",
  ]);
  const environmentMode = (await stat(environmentPath)).mode & 0o777;
  const operatorMode = (await stat(operatorPath)).mode & 0o777;
  assert(environmentMode === 0o600, "Generated environment must use mode 0600.");
  assert(operatorMode === 0o600, "Generated operator token must use mode 0600.");

  const environment = await readFile(environmentPath, "utf8");
  const operatorToken = (await readFile(operatorPath, "utf8")).trim();
  assert(operatorToken.length >= 48, "Generated operator token is too short.");
  assert(!environment.includes(operatorToken), "Raw operator token leaked into environment file.");
  for (const key of [
    "POSTGRES_PASSWORD",
    "DATABASE_URL",
    "MINIO_ROOT_USER",
    "MINIO_ROOT_PASSWORD",
    "OBJECT_STORAGE_ACCESS_KEY",
    "OBJECT_STORAGE_SECRET_KEY",
    "OPERATOR_TOKENS_JSON",
    "MELI_TOKEN_VAULT_KEY_BASE64",
    "MELI_WEBHOOK_TOKEN",
    "RESTIC_PASSWORD",
  ]) {
    const value = readEnvironmentValue(environment, key);
    assert(Boolean(value && !value.includes("__REQUIRED__")), `${key} was not generated.`);
  }

  run("node", ["scripts/credentials-doctor.mjs", "--template", `--env=${environmentPath}`]);
  console.log("✓ credential generation, permissions, separation and validation verified");
} finally {
  await rm(directory, { recursive: true, force: true });
}

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${arguments_.join(" ")} failed: ${(result.stderr || result.stdout).replace(/[\r\n\t]+/g, " ").slice(0, 1_000)}`,
    );
  }
}

function readEnvironmentValue(content, key) {
  const line = content.split(/\r?\n/).find((candidate) => candidate.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
