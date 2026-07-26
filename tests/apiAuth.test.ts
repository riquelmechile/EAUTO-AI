import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../apps/api/src/app.js";
import { hashToken } from "../apps/api/src/auth.js";
import { loadConfig } from "../apps/api/src/config.js";

const enrollmentToken = "viewer-secret-token";
const config = loadConfig({
  NODE_ENV: "test",
  AUTH_MODE: "static-token",
  OPERATOR_TOKENS_JSON: JSON.stringify([
    {
      id: "viewer-plasticov",
      tokenHash: hashToken(enrollmentToken),
      organizationId: "maustian",
      roles: ["viewer"],
      accountIds: ["plasticov"],
    },
  ]),
});

type SessionPayload = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
};

async function enroll(app: FastifyInstance): Promise<SessionPayload> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/session",
    headers: { authorization: `Bearer ${enrollmentToken}` },
  });
  expect(response.statusCode).toBe(201);
  return response.json<SessionPayload>();
}

describe("API authentication", () => {
  it("rejects missing sessions and returns only authorized accounts", async () => {
    const app = await buildApp(config);
    try {
      const anonymous = await app.inject({ method: "GET", url: "/v1/dashboard" });
      expect(anonymous.statusCode).toBe(401);

      const session = await enroll(app);
      const authorized = await app.inject({
        method: "GET",
        url: "/v1/dashboard",
        headers: { authorization: `Bearer ${session.accessToken}` },
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

  it("rotates refresh tokens and rejects the previous refresh token", async () => {
    const app = await buildApp(config);
    try {
      const session = await enroll(app);
      const refreshed = await app.inject({
        method: "POST",
        url: "/v1/auth/refresh",
        headers: { authorization: `Bearer ${session.refreshToken}` },
      });
      expect(refreshed.statusCode).toBe(200);
      const rotated = refreshed.json<SessionPayload>();
      expect(rotated.accessToken).not.toBe(session.accessToken);
      expect(rotated.refreshToken).not.toBe(session.refreshToken);

      const replay = await app.inject({
        method: "POST",
        url: "/v1/auth/refresh",
        headers: { authorization: `Bearer ${session.refreshToken}` },
      });
      expect(replay.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("revokes an access session on logout", async () => {
    const app = await buildApp(config);
    try {
      const session = await enroll(app);
      const logout = await app.inject({
        method: "POST",
        url: "/v1/auth/logout",
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      expect(logout.statusCode).toBe(204);

      const afterLogout = await app.inject({
        method: "GET",
        url: "/v1/dashboard",
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      expect(afterLogout.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("forbids a viewer from creating commercial content", async () => {
    const app = await buildApp(config);
    try {
      const session = await enroll(app);
      const response = await app.inject({
        method: "POST",
        url: "/v1/content/launches",
        headers: { authorization: `Bearer ${session.accessToken}` },
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
      const session = await enroll(app);
      const response = await app.inject({
        method: "GET",
        url: "/v1/inbox?accountId=maustian",
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
