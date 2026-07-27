import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

async function validProductionEnvironment(): Promise<string> {
  const template = await source(".env.production.example");
  const replacements: Readonly<Record<string, string>> = {
    EAS_PROJECT_ID: "eas-project-id",
    EAUTO_IMAGE: `ghcr.io/riquelmechile/eauto-ai@sha256:${"a".repeat(64)}`,
    OPERATOR_TOKENS_JSON: JSON.stringify([
      {
        id: "owner",
        tokenHash: "b".repeat(64),
        organizationId: "maustian",
        roles: ["owner"],
        accountIds: ["plasticov", "maustian"],
      },
    ]),
    POSTGRES_PASSWORD: "database-password",
    DATABASE_URL: "postgres://eauto:database-password@postgres:5432/eauto",
    MINIO_ROOT_USER: "minio-user",
    MINIO_ROOT_PASSWORD: "minio-password",
    OBJECT_STORAGE_ACCESS_KEY: "minio-user",
    OBJECT_STORAGE_SECRET_KEY: "minio-password",
    CONTENT_PROVIDER_API_KEY: "content-provider-key",
    ACTION_PROVIDER_API_KEY: "action-provider-key",
    LLM_API_KEY: "deepseek-key",
    MELI_CLIENT_ID: "meli-client",
    MELI_CLIENT_SECRET: "meli-secret",
    MELI_TOKEN_VAULT_KEY_BASE64: Buffer.alloc(32, 7).toString("base64"),
    MELI_PLASTICOV_SELLER_ID: "100001",
    MELI_MAUSTIAN_SELLER_ID: "100002",
    MELI_APPLICATION_ID: "100003",
    MELI_WEBHOOK_TOKEN: "webhook-token-0123456789abcdef012345",
    RESTIC_REPOSITORY: "s3:https://backup.example.cl/eauto",
    RESTIC_PASSWORD: "restic-password",
    RESTIC_AWS_ACCESS_KEY_ID: "restic-access-key",
    RESTIC_AWS_SECRET_ACCESS_KEY: "restic-secret-key",
  };
  return template
    .split(/\r?\n/)
    .map((line) => {
      const separator = line.indexOf("=");
      if (separator < 1) return line;
      const key = line.slice(0, separator);
      return key in replacements ? `${key}=${replacements[key]}` : line;
    })
    .join("\n");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("immutable production deployment", () => {
  it("does not allow a mutable runtime image or reconstructed database URL", async () => {
    const compose = await source("infra/compose/docker-compose.production.yml");
    expect(compose).toContain("image: ${EAUTO_IMAGE:?");
    expect(compose).not.toContain("eauto-ai:latest");
    expect(compose).not.toMatch(/DATABASE_URL:\s*postgres:\/\/\$\{POSTGRES_USER\}/);
  });

  it("fails deployment instead of reusing a stale local image", async () => {
    const deploy = await source("scripts/deploy-production.sh");
    expect(deploy).toContain("pull --policy always");
    expect(deploy).toContain('docker image inspect "${eauto_image}"');
    expect(deploy).not.toContain("pull api worker caddy postgres || true");
  });

  it("accepts only a complete environment with an immutable GHCR digest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "eauto-production-doctor-"));
    temporaryDirectories.push(directory);
    const envPath = join(directory, ".env.production");
    const valid = await validProductionEnvironment();
    await writeFile(envPath, valid, "utf8");

    const accepted = spawnSync(
      process.execPath,
      ["scripts/production-doctor.mjs", `--env=${envPath}`],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(accepted.status, `${accepted.stdout}\n${accepted.stderr}`).toBe(0);

    await writeFile(
      envPath,
      valid.replace(
        /^EAUTO_IMAGE=.*$/m,
        "EAUTO_IMAGE=ghcr.io/riquelmechile/eauto-ai:latest",
      ),
      "utf8",
    );
    const rejected = spawnSync(
      process.execPath,
      ["scripts/production-doctor.mjs", `--env=${envPath}`],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(rejected.status).toBe(1);
    expect(`${rejected.stdout}\n${rejected.stderr}`).toContain("EAUTO_IMAGE must be the immutable");
  });

  it("detects placeholders embedded inside URLs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "eauto-production-placeholder-"));
    temporaryDirectories.push(directory);
    const envPath = join(directory, ".env.production");
    const valid = await validProductionEnvironment();
    await writeFile(
      envPath,
      valid.replace(
        /^DATABASE_URL=.*$/m,
        "DATABASE_URL=postgres://eauto:__REQUIRED__@postgres:5432/eauto",
      ),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      ["scripts/production-doctor.mjs", `--env=${envPath}`],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("DATABASE_URL pending");
  });
});
