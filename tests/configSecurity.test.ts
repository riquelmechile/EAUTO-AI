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

const baseProduction = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://eauto:eauto@localhost:5432/eauto",
  AUTH_MODE: "static-token",
  OPERATOR_TOKENS_JSON: productionIdentity,
  OBJECT_STORAGE_PUBLIC_ENDPOINT: "https://uploads.example.com",
} as const;

const mercadoLibreChile = {
  MELI_ENABLED: "true",
  MELI_CLIENT_ID: "client-id",
  MELI_CLIENT_SECRET: "client-secret",
  MELI_REDIRECT_URI: "https://api.example.com/v1/integrations/mercadolibre/oauth/callback",
  MELI_TOKEN_VAULT_KEY_BASE64: Buffer.alloc(32, 9).toString("base64"),
  MELI_PLASTICOV_SELLER_ID: "111",
  MELI_MAUSTIAN_SELLER_ID: "222",
} as const;

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

  it("rejects production without a public HTTPS upload endpoint", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://eauto:eauto@localhost:5432/eauto",
        AUTH_MODE: "static-token",
        OPERATOR_TOKENS_JSON: productionIdentity,
      }),
    ).toThrow(/OBJECT_STORAGE_PUBLIC_ENDPOINT/);

    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://eauto:eauto@localhost:5432/eauto",
        AUTH_MODE: "static-token",
        OPERATOR_TOKENS_JSON: productionIdentity,
        OBJECT_STORAGE_PUBLIC_ENDPOINT: "http://uploads.example.com",
      }),
    ).toThrow(/must use HTTPS/);
  });

  it("parses false as false instead of a truthy string", () => {
    const config = loadConfig({ OBJECT_STORAGE_FORCE_PATH_STYLE: "false" });
    expect(config.OBJECT_STORAGE_FORCE_PATH_STYLE).toBe(false);
  });

  it("accepts a hashed owner identity and HTTPS upload endpoint", () => {
    const config = loadConfig(baseProduction);
    expect(config.AUTH_MODE).toBe("static-token");
    expect(config.OBJECT_STORAGE_PUBLIC_ENDPOINT).toBe("https://uploads.example.com");
  });

  it("keeps MercadoLibre disabled unless the complete Chile configuration exists", () => {
    expect(loadConfig({}).MELI_ENABLED).toBe(false);
    expect(() => loadConfig({ MELI_ENABLED: "true" })).toThrow(/MELI_ENABLED requires/);
  });

  it("requires different Plasticov and Maustian seller identities", () => {
    expect(() =>
      loadConfig({
        ...mercadoLibreChile,
        MELI_MAUSTIAN_SELLER_ID: "111",
      }),
    ).toThrow(/different MercadoLibre seller IDs/);
  });

  it("requires the Chile authorization host and a 32-byte AES key", () => {
    expect(() =>
      loadConfig({
        ...mercadoLibreChile,
        MELI_AUTHORIZATION_URL: "https://auth.mercadolivre.com.br/authorization",
      }),
    ).toThrow(/Chile authorization host/);
    expect(() =>
      loadConfig({
        ...mercadoLibreChile,
        MELI_TOKEN_VAULT_KEY_BASE64: Buffer.alloc(16).toString("base64"),
      }),
    ).toThrow(/32 bytes/);
  });

  it("accepts a complete fail-closed MercadoLibre Chile production configuration", () => {
    const config = loadConfig({ ...baseProduction, ...mercadoLibreChile });
    expect(config.MELI_ENABLED).toBe(true);
    expect(config.MELI_AUTHORIZATION_URL).toBe("https://auth.mercadolibre.cl/authorization");
    expect(config.MELI_PLASTICOV_SELLER_ID).toBe("111");
    expect(config.MELI_MAUSTIAN_SELLER_ID).toBe("222");
  });
});
