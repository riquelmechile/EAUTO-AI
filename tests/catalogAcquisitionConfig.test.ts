import { describe, expect, it } from "vitest";
import { loadConfig } from "../apps/api/src/config.js";

const supplierRoutes = JSON.stringify({
  "supplier-1": "https://catalog.example.com/v1/suppliers/supplier-1/search",
});

const enabled = Object.freeze({
  CATALOG_ACQUISITION_ENABLED: "true",
  CATALOG_VISUAL_PROVIDER_URL: "https://catalog.example.com/v1/photo-similarity",
  CATALOG_VISUAL_PROVIDER_API_KEY: "visual-secret",
  PRODUCT_FINGERPRINT_PROVIDER_URL: "https://fingerprint.example.com/v1/phash",
  PRODUCT_FINGERPRINT_PROVIDER_API_KEY: "fingerprint-secret",
  CATALOG_SUPPLIER_ROUTES_JSON: supplierRoutes,
  CATALOG_SUPPLIER_API_KEY: "supplier-secret",
});

describe("catalog acquisition configuration", () => {
  it("is disabled by default and exposes no supplier routes", () => {
    const config = loadConfig({});
    expect(config.CATALOG_ACQUISITION_ENABLED).toBe(false);
    expect(config.CATALOG_SUPPLIER_ROUTES_JSON).toBe("{}");
    expect(config.PRODUCT_FINGERPRINT_PROVIDER_URL).toBeUndefined();
    expect(config.PRODUCT_FINGERPRINT_PROVIDER_VERSION).toBe("phash-64-v1");
  });

  it("requires visual, perceptual fingerprint and supplier gateways", () => {
    expect(() =>
      loadConfig({
        CATALOG_ACQUISITION_ENABLED: "true",
      }),
    ).toThrow(/requires visual URL/);

    expect(() =>
      loadConfig({
        ...enabled,
        PRODUCT_FINGERPRINT_PROVIDER_API_KEY: "",
      }),
    ).toThrow(/configured together/);

    expect(() =>
      loadConfig({
        ...enabled,
        CATALOG_SUPPLIER_ROUTES_JSON: "{}",
      }),
    ).toThrow(/at least one supplier route/);
  });

  it("rejects invalid route JSON and credential-bearing endpoints", () => {
    expect(() =>
      loadConfig({
        CATALOG_SUPPLIER_ROUTES_JSON: "[not-json]",
      }),
    ).toThrow(/valid JSON/);

    expect(() =>
      loadConfig({
        ...enabled,
        CATALOG_SUPPLIER_ROUTES_JSON: JSON.stringify({
          "supplier-1": "https://user:secret@catalog.example.com/search",
        }),
      }),
    ).toThrow(/cannot embed credentials/);

    expect(() =>
      loadConfig({
        PRODUCT_FINGERPRINT_PROVIDER_URL: "https://user:secret@fingerprint.example.com/v1/phash",
        PRODUCT_FINGERPRINT_PROVIDER_API_KEY: "fingerprint-secret",
      }),
    ).toThrow(/cannot embed credentials/);
  });

  it("requires HTTPS provider routes in production", () => {
    expect(() =>
      loadConfig({
        ...enabled,
        NODE_ENV: "production",
        CATALOG_VISUAL_PROVIDER_URL: "http://catalog.example.com/v1/photo-similarity",
      }),
    ).toThrow(/must use HTTPS/);

    expect(() =>
      loadConfig({
        ...enabled,
        NODE_ENV: "production",
        PRODUCT_FINGERPRINT_PROVIDER_URL: "http://fingerprint.example.com/v1/phash",
      }),
    ).toThrow(/must use HTTPS/);

    expect(() =>
      loadConfig({
        ...enabled,
        NODE_ENV: "production",
        CATALOG_SUPPLIER_ROUTES_JSON: JSON.stringify({
          "supplier-1": "http://catalog.example.com/search",
        }),
      }),
    ).toThrow(/must use HTTPS/);
  });

  it("accepts a complete allowlisted configuration with server policies", () => {
    const config = loadConfig({
      ...enabled,
      PRODUCT_FINGERPRINT_PROVIDER_NAME: "perceptual-gateway",
      PRODUCT_FINGERPRINT_PROVIDER_VERSION: "phash-64-v3",
      PRODUCT_FINGERPRINT_TIMEOUT_MS: "8000",
      PRODUCT_FINGERPRINT_MAX_RESPONSE_BYTES: "32000",
      CATALOG_MINIMUM_SIMILARITY_BPS: "8500",
      CATALOG_MAXIMUM_EVIDENCE_AGE_MS: "7200000",
      CATALOG_POLICY_VERSION: "catalog-policy-v2",
    });
    expect(config.CATALOG_ACQUISITION_ENABLED).toBe(true);
    expect(config.PRODUCT_FINGERPRINT_PROVIDER_NAME).toBe("perceptual-gateway");
    expect(config.PRODUCT_FINGERPRINT_PROVIDER_VERSION).toBe("phash-64-v3");
    expect(config.PRODUCT_FINGERPRINT_TIMEOUT_MS).toBe(8_000);
    expect(config.PRODUCT_FINGERPRINT_MAX_RESPONSE_BYTES).toBe(32_000);
    expect(config.CATALOG_MINIMUM_SIMILARITY_BPS).toBe(8_500);
    expect(config.CATALOG_MAXIMUM_EVIDENCE_AGE_MS).toBe(7_200_000);
    expect(config.CATALOG_POLICY_VERSION).toBe("catalog-policy-v2");
  });
});
