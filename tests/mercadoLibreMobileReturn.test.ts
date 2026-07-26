import { describe, expect, it } from "vitest";
import {
  MERCADOLIBRE_MOBILE_RETURN_URI,
  createMercadoLibreMobileReturnUrl,
} from "../apps/api/src/mercadoLibreRoutes.js";

describe("MercadoLibre Android OAuth return", () => {
  it("uses the fixed EAUTO-AI scheme and contains no OAuth credentials", () => {
    const result = createMercadoLibreMobileReturnUrl({
      accountId: "plasticov",
      siteId: "MLC",
      status: "active",
    });
    const url = new URL(result);

    expect(MERCADOLIBRE_MOBILE_RETURN_URI).toBe("eautoai://mercadolibre/oauth-complete");
    expect(url.protocol).toBe("eautoai:");
    expect(url.hostname).toBe("mercadolibre");
    expect(url.pathname).toBe("/oauth-complete");
    expect(url.searchParams.get("result")).toBe("connected");
    expect(url.searchParams.get("accountId")).toBe("plasticov");
    expect(url.searchParams.get("siteId")).toBe("MLC");
    expect(url.searchParams.has("code")).toBe(false);
    expect(url.searchParams.has("state")).toBe(false);
    expect(url.searchParams.has("access_token")).toBe(false);
    expect(url.searchParams.has("refresh_token")).toBe(false);
  });
});
