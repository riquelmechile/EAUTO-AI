import { describe, expect, it } from "vitest";
import { buildApp } from "../apps/api/src/app.js";
import { hashToken } from "../apps/api/src/auth.js";
import { loadConfig } from "../apps/api/src/config.js";

const token = "viewer-secret-token";
const config = loadConfig({
  NODE_ENV: "test",
  AUTH_MODE: "static-token",
  OPERATOR_TOKENS_JSON: JSON.stringify([
    {
      id: "viewer-plasticov",
      tokenHash: hashToken(token),
      organizationId: "maustian",
      roles: ["viewer"],
      accountIds: ["plasticov"],
    },
  ]),
});

describe("API authentication", () => {
  it("rejects missing tokens and returns only authorized accounts", async () => {
    const app = await buildApp(config);
    try {
      const anonymous = await app.inject({ method: "GET", url: "/v1/dashboard" });
      expect(anonymous.statusCode).toBe(401);

      const authorized = await app.inject({
        method: "GET",
        url: "/v1/dashboard",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(authorized.statusCode).toBe(200);
      const payload = authorized.json<{
        actor: { id: string };
        accounts: readonly { id: string }[];
      }>();
      expect(payload.actor.id).toBe("viewer-plasticov");
      expect(payload.accounts.map((account) => account.id)).toEqual(["plasticov"]);
    } finally {
      await app.close();
    }
  });

  it("forbids a viewer from creating commercial content", async () => {
    const app = await buildApp(config);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/content/launches",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          id: "launch-1",
          accountId: "plasticov",
          sourceImageUri: "file://product.jpg",
          requestedChannels: ["mercadolibre"],
        },
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("hides accounts outside the actor scope", async () => {
    const app = await buildApp(config);
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/inbox?accountId=maustian",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
