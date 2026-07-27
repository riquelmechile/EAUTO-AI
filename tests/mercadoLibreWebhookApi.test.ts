import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { buildApp } from "../apps/api/src/app.js";
import { loadConfig } from "../apps/api/src/config.js";

function webhookConfig() {
  return loadConfig({
    NODE_ENV: "test",
    AUTH_MODE: "disabled",
    MELI_ENABLED: "true",
    MELI_CLIENT_ID: "client-123",
    MELI_CLIENT_SECRET: "secret-123",
    MELI_REDIRECT_URI: "https://example.test/v1/integrations/mercadolibre/oauth/callback",
    MELI_TOKEN_VAULT_KEY_BASE64: Buffer.alloc(32, 4).toString("base64"),
    MELI_PLASTICOV_SELLER_ID: "111",
    MELI_MAUSTIAN_SELLER_ID: "222",
    MELI_WEBHOOK_ENABLED: "true",
    MELI_APPLICATION_ID: "app-123",
  });
}

const notification = {
  _id: "source-notification-1",
  resource: "/orders/5001",
  user_id: "111",
  topic: "orders_v2",
  application_id: "app-123",
  attempts: 1,
  sent: "2026-07-26T11:59:00.000Z",
  received: "2026-07-26T12:00:00.000Z",
};

describe("MercadoLibre webhook API", () => {
  it("acknowledges quickly and deduplicates the same delivery", async () => {
    const app = await buildApp(webhookConfig());
    try {
      const first = await app.inject({
        method: "POST",
        url: "/v1/webhooks/mercadolibre",
        payload: notification,
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual({ ok: true, queued: true });

      const duplicate = await app.inject({
        method: "POST",
        url: "/v1/webhooks/mercadolibre",
        payload: notification,
      });
      expect(duplicate.statusCode).toBe(200);
      expect(duplicate.json()).toEqual({ ok: true, queued: false });
    } finally {
      await app.close();
    }
  });

  it("does not reveal whether an application, seller or topic is configured", async () => {
    const app = await buildApp(webhookConfig());
    try {
      for (const payload of [
        { ...notification, application_id: "unknown-app" },
        { ...notification, user_id: "999" },
        { ...notification, topic: "messages" },
      ]) {
        const response = await app.inject({
          method: "POST",
          url: "/v1/webhooks/mercadolibre",
          payload,
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ ok: true, queued: false });
      }
    } finally {
      await app.close();
    }
  });
});

describe("MercadoLibre webhook configuration", () => {
  it("fails closed when webhook mode lacks an application ID", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        MELI_WEBHOOK_ENABLED: "true",
      }),
    ).toThrow(/MELI_WEBHOOK_ENABLED requires/);
  });
});
