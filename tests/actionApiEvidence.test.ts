import { describe, expect, it } from "vitest";
import { buildApp } from "../apps/api/src/app.js";
import { loadConfig } from "../apps/api/src/config.js";

const oldClientControlledAction = {
  id: "client-controlled-id",
  accountId: "plasticov",
  kind: "price.update",
  target: "MLC1",
  exactChanges: [{ field: "price", from: 1000, to: 900 }],
  rationale: "Client-provided evidence must not be trusted",
  risk: "low",
  evidenceBundle: {
    id: "fake-evidence",
    accountId: "plasticov",
    references: [
      {
        id: "fake",
        source: "client",
        sourceRecordId: "MLC1",
        observedAt: "2026-07-26T00:00:00.000Z",
        freshness: "fresh",
        confidence: "high",
        contentHash: "fake",
      },
    ],
    complete: true,
    missingInputs: [],
  },
  policyVersion: "client-policy",
  expiresAt: "2030-01-01T00:00:00.000Z",
};

describe("action evidence API", () => {
  it("rejects the legacy client-controlled evidence contract", async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: "test", AUTH_MODE: "disabled" }));
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/actions",
        payload: oldClientControlledAction,
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("does not materialize an action from a missing authoritative evidence pack", async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: "test", AUTH_MODE: "disabled" }));
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/actions",
        payload: {
          accountId: "plasticov",
          kind: "price.update",
          target: "MLC1",
          exactChanges: [{ field: "price", from: 1000, to: 900 }],
          rationale: "Use authoritative evidence only",
          risk: "low",
          evidencePackId: "missing-pack",
        },
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
