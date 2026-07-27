import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../apps/api/src/app.js";
import { hashToken } from "../apps/api/src/auth.js";
import { loadConfig } from "../apps/api/src/config.js";

const viewerEnrollmentToken = "agent-os-viewer-token";
const viewerConfig = loadConfig({
  NODE_ENV: "test",
  AUTH_MODE: "static-token",
  OPERATOR_TOKENS_JSON: JSON.stringify([
    {
      id: "viewer-plasticov",
      tokenHash: hashToken(viewerEnrollmentToken),
      organizationId: "maustian",
      roles: ["viewer"],
      accountIds: ["plasticov"],
    },
  ]),
});

async function enroll(app: FastifyInstance, token: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/session",
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ accessToken: string }>().accessToken;
}

describe("Agent OS API", () => {
  it("exposes the catalog to scoped viewers but forbids planning", async () => {
    const app = await buildApp(viewerConfig);
    try {
      const accessToken = await enroll(app, viewerEnrollmentToken);
      const headers = { authorization: `Bearer ${accessToken}` };
      const catalog = await app.inject({
        method: "GET",
        url: "/v1/agent-os/catalog?accountId=plasticov",
        headers,
      });
      expect(catalog.statusCode).toBe(200);
      expect(
        catalog.json<{ contracts: readonly { id: string }[] }>().contracts.length,
      ).toBeGreaterThan(20);

      const forbidden = await app.inject({
        method: "POST",
        url: "/v1/agent-os/plasticov/plans/company",
        headers,
        payload: { objective: "analiza rentabilidad y stock" },
      });
      expect(forbidden.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("creates and completes a bounded CEO work session in owner development mode", async () => {
    const app = await buildApp(
      loadConfig({
        NODE_ENV: "test",
        AUTH_MODE: "disabled",
        AGENT_MANUAL_CONTROL_ENABLED: "true",
      }),
    );
    try {
      const plan = await app.inject({
        method: "POST",
        url: "/v1/agent-os/plasticov/plans/company",
        payload: {
          objective: "analiza rentabilidad, inventario y reclamos",
          budgetMinorClp: 30_000,
        },
      });
      expect(plan.statusCode).toBe(200);
      expect(plan.json<{ tasks: readonly unknown[] }>().tasks.length).toBeGreaterThan(0);

      const created = await app.inject({
        method: "POST",
        url: "/v1/agent-os/plasticov/sessions",
        payload: {
          objectiveId: "objective-1",
          agentId: "ceo",
          parentSessionId: null,
          requestedAction: "plan.create",
          availableEvidenceKinds: [
            "company-state",
            "policy-version",
            "source-provenance",
            "receipt-chain",
          ],
          evidenceRefs: ["evidence:company-state"],
          autonomy: "inform",
          requestedBudgetMinorClp: 1_000,
          spentTodayMinorClp: 0,
          policyAllowed: true,
          stableContextRefs: ["contract:ceo@1.0.0", "policy:v1"],
          volatileContextRefs: ["objective:1"],
          idempotencyKey: "objective-1-ceo-plan",
          deadlineAt: "2026-07-28T00:00:00.000Z",
        },
      });
      expect(created.statusCode).toBe(201);
      const sessionId = created.json<{ session: { id: string } }>().session.id;

      const started = await app.inject({
        method: "POST",
        url: `/v1/agent-os/plasticov/sessions/${sessionId}/start`,
      });
      expect(started.statusCode).toBe(200);

      const completed = await app.inject({
        method: "POST",
        url: `/v1/agent-os/plasticov/sessions/${sessionId}/complete`,
        payload: { outputRefs: ["receipt:verified:plan-1"], spentMinorClp: 500 },
      });
      expect(completed.statusCode).toBe(200);
      expect(completed.json<{ status: string }>().status).toBe("completed");
    } finally {
      await app.close();
    }
  });

  it("blocks raw session control when the governed worker is the authority", async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: "test", AUTH_MODE: "disabled" }));
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/agent-os/plasticov/sessions",
        payload: {},
      });
      expect(response.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });

  it("hides Agent OS records from another account", async () => {
    const app = await buildApp(viewerConfig);
    try {
      const accessToken = await enroll(app, viewerEnrollmentToken);
      const response = await app.inject({
        method: "GET",
        url: "/v1/agent-os/maustian/sessions",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
