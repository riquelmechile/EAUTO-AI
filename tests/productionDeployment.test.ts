import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

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

  it("requires an immutable GHCR digest in the production template", async () => {
    const template = await source(".env.production.example");
    expect(template).toContain(
      "EAUTO_IMAGE=ghcr.io/riquelmechile/eauto-ai@sha256:__REQUIRED__",
    );
    expect(template).toContain("Percent-encode reserved characters");
  });

  it("detects embedded placeholders and validates the immutable digest", async () => {
    const doctor = await source("scripts/production-doctor.mjs");
    expect(doctor).toContain('value.includes("__REQUIRED__")');
    expect(doctor).toContain("immutableImagePattern");
    expect(doctor).toContain("DATABASE_URL must be a valid PostgreSQL URL");
  });
});
