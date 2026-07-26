import { describe, expect, it } from "vitest";
import { loadConfig } from "../apps/api/src/config.js";
import { hashToken } from "../apps/api/src/auth.js";

const productionIdentity = JSON.stringify([
  {
    id: "sebastian",
    tokenHash: hashToken("secret-owner-token"),
    organizationId: "maustian",
    roles: ["owner"],
    accountIds: ["plasticov", "maustian"],
  },
]);

describe("production security configuration", () => {
  it("rejects production without Postgres and authentication", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/DATABASE_URL/);
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://eauto:eauto@localhost:5432/eauto",
      }),
    ).toThrow(/AUTH_MODE=static-token/);
  });

  it("rejects production without at least one operator identity", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://eauto:eauto@localhost:5432/eauto",
        AUTH_MODE: "static-token",
        OPERATOR_TOKENS_JSON: "[]",
      }),
    ).toThrow(/operator identity/);
  });

  it("rejects production without a public signed upload endpoint", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://eauto:eauto@localhost:5432/eauto",
        AUTH_MODE: "static-token",
        OPERATOR_TOKENS_JSON: productionIdentity,
      }),
    ).toThrow(/OBJECT_STORAGE_PUBLIC_ENDPOINT/);
  });

  it("accepts a hashed owner identity and HTTPS upload endpoint", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://eauto:eauto@localhost:5432/eauto",
      AUTH_MODE: "static-token",
      OPERATOR_TOKENS_JSON: productionIdentity,
      OBJECT_STORAGE_PUBLIC_ENDPOINT: "https://uploads.example.com",
    });
    expect(config.AUTH_MODE).toBe("static-token");
    expect(config.OBJECT_STORAGE_PUBLIC_ENDPOINT).toBe("https://uploads.example.com");
  });
});
