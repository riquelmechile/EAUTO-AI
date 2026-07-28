import { describe, expect, it } from "vitest";
import { loadConfig } from "../apps/api/src/config.js";

const mercadoLibre = {
  DATABASE_URL: "postgres://eauto:eauto@localhost:5432/eauto",
  MELI_ENABLED: "true",
  MELI_CLIENT_ID: "client-id",
  MELI_CLIENT_SECRET: "client-secret",
  MELI_REDIRECT_URI: "https://api.example.cl/v1/integrations/mercadolibre/oauth/callback",
  MELI_TOKEN_VAULT_KEY_BASE64: Buffer.alloc(32, 4).toString("base64"),
  MELI_PLASTICOV_SELLER_ID: "111",
  MELI_MAUSTIAN_SELLER_ID: "222",
} as const;

describe("MercadoLibre Product Ads configuration", () => {
  it("is disabled by default", () => {
    expect(loadConfig({}).MELI_PRODUCT_ADS_ENABLED).toBe(false);
  });

  it("requires MercadoLibre and durable PostgreSQL storage", () => {
    expect(() =>
      loadConfig({
        MELI_PRODUCT_ADS_ENABLED: "true",
        MELI_PRODUCT_ADS_ACCOUNT_ID: "plasticov",
      }),
    ).toThrow(/requires MELI_ENABLED and durable PostgreSQL/);
  });

  it("restricts the first rollout to Plasticov", () => {
    expect(() =>
      loadConfig({
        ...mercadoLibre,
        MELI_PRODUCT_ADS_ENABLED: "true",
        MELI_PRODUCT_ADS_ACCOUNT_ID: "maustian",
      }),
    ).toThrow(/restricted to the Plasticov account/);
  });

  it("accepts an empty mapping for fail-closed advertiser discovery", () => {
    const config = loadConfig({
      ...mercadoLibre,
      MELI_PRODUCT_ADS_ENABLED: "true",
      MELI_PRODUCT_ADS_ACCOUNT_ID: "plasticov",
      MELI_PRODUCT_ADS_ADVERTISER_IDS_JSON: "{}",
    });
    expect(config.MELI_PRODUCT_ADS_ENABLED).toBe(true);
    expect(config.MELI_PRODUCT_ADS_ACCOUNT_ID).toBe("plasticov");
  });

  it("accepts numeric advertiser IDs and rejects malformed mappings", () => {
    const configured = loadConfig({
      ...mercadoLibre,
      MELI_PRODUCT_ADS_ENABLED: "true",
      MELI_PRODUCT_ADS_ACCOUNT_ID: "plasticov",
      MELI_PRODUCT_ADS_ADVERTISER_IDS_JSON: JSON.stringify({ plasticov: "123456" }),
    });
    expect(configured.MELI_PRODUCT_ADS_ADVERTISER_IDS_JSON).toBe('{"plasticov":"123456"}');

    expect(() =>
      loadConfig({
        ...mercadoLibre,
        MELI_PRODUCT_ADS_ENABLED: "true",
        MELI_PRODUCT_ADS_ACCOUNT_ID: "plasticov",
        MELI_PRODUCT_ADS_ADVERTISER_IDS_JSON: JSON.stringify({ plasticov: "not-numeric" }),
      }),
    ).toThrow(/numeric IDs/);
    expect(() =>
      loadConfig({
        ...mercadoLibre,
        MELI_PRODUCT_ADS_ENABLED: "true",
        MELI_PRODUCT_ADS_ACCOUNT_ID: "plasticov",
        MELI_PRODUCT_ADS_ADVERTISER_IDS_JSON: "[]",
      }),
    ).toThrow(/must contain an object/);
  });
});
