import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AcquisitionCandidate } from "@eauto/domain";
import { buildApp } from "../apps/api/src/app.js";
import { hashToken } from "../apps/api/src/auth.js";
import { loadConfig } from "../apps/api/src/config.js";
import { createRuntime } from "../apps/api/src/runtime.js";

const tokens = Object.freeze({
  viewer: "catalog-viewer-secret",
  reviewer: "catalog-reviewer-secret",
  operator: "catalog-operator-secret",
});
const config = loadConfig({
  NODE_ENV: "test",
  AUTH_MODE: "static-token",
  OPERATOR_TOKENS_JSON: JSON.stringify([
    {
      id: "catalog-viewer",
      tokenHash: hashToken(tokens.viewer),
      organizationId: "maustian",
      roles: ["viewer"],
      accountIds: ["plasticov"],
    },
    {
      id: "catalog-reviewer",
      tokenHash: hashToken(tokens.reviewer),
      organizationId: "maustian",
      roles: ["reviewer"],
      accountIds: ["plasticov"],
    },
    {
      id: "catalog-operator",
      tokenHash: hashToken(tokens.operator),
      organizationId: "maustian",
      roles: ["operator"],
      accountIds: ["plasticov"],
    },
  ]),
});

const candidate: AcquisitionCandidate = Object.freeze({
  id: "acquisition-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  contentHash: "a".repeat(64),
  organizationId: "maustian",
  accountId: "plasticov",
  sourceImageUploadId: "upload-catalog-1",
  visualProvider: "visual-provider",
  externalMatchId: "match-1",
  similarityBps: 9_000,
  supplierSourceId: "supplier-1",
  sku: "SKU-1",
  name: "Candidate product",
  productUrl: "https://supplier.example/products/sku-1",
  unitCostMinor: 10_000,
  stockQuantity: 12,
  currencyId: "CLP",
  evidenceRefs: Object.freeze(["visual-evidence-1", "catalog-evidence-1"]),
  policyVersion: "catalog-acquisition-v1",
  status: "needs-review",
  requiresHumanApproval: true,
  createdAt: "2026-07-28T00:00:00.000Z",
  reviewedAt: null,
  reviewedBy: null,
  reviewNote: null,
});

type SessionPayload = { accessToken: string };

async function enroll(app: FastifyInstance, token: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/session",
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.statusCode).toBe(201);
  return response.json<SessionPayload>().accessToken;
}

async function createSeededApp() {
  const runtime = createRuntime(config);
  await runtime.catalogCandidates.save(candidate);
  const app = await buildApp(config, runtime);
  return { app, runtime };
}

describe("Catalog acquisition API", () => {
  it("allows a viewer to list candidates but not discover or review", async () => {
    const { app } = await createSeededApp();
    try {
      const accessToken = await enroll(app, tokens.viewer);
      const listed = await app.inject({
        method: "GET",
        url: "/v1/catalog-acquisition/candidates?accountId=plasticov",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json<{ candidates: AcquisitionCandidate[] }>().candidates).toEqual([candidate]);

      const discover = await app.inject({
        method: "POST",
        url: "/v1/catalog-acquisition/discover",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { accountId: "plasticov", sourceImageUploadId: "upload-catalog-1" },
      });
      expect(discover.statusCode).toBe(403);

      const review = await app.inject({
        method: "POST",
        url: `/v1/catalog-acquisition/candidates/${candidate.id}/review`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { accountId: "plasticov", decision: "accepted" },
      });
      expect(review.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("allows one reviewer transition and rejects a replay", async () => {
    const { app } = await createSeededApp();
    try {
      const accessToken = await enroll(app, tokens.reviewer);
      const first = await app.inject({
        method: "POST",
        url: `/v1/catalog-acquisition/candidates/${candidate.id}/review`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          accountId: "plasticov",
          decision: "accepted",
          note: "Producto confirmado.",
        },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json<AcquisitionCandidate>()).toMatchObject({
        status: "accepted",
        reviewedBy: "catalog-reviewer",
        reviewNote: "Producto confirmado.",
      });

      const replay = await app.inject({
        method: "POST",
        url: `/v1/catalog-acquisition/candidates/${candidate.id}/review`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { accountId: "plasticov", decision: "rejected" },
      });
      expect(replay.statusCode).toBe(409);
      expect(replay.json<{ error: string }>().error).toBe("catalog-acquisition-conflict");
    } finally {
      await app.close();
    }
  });

  it("returns a controlled unavailable response when discovery providers are disabled", async () => {
    const { app } = await createSeededApp();
    try {
      const accessToken = await enroll(app, tokens.operator);
      const response = await app.inject({
        method: "POST",
        url: "/v1/catalog-acquisition/discover",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { accountId: "plasticov", sourceImageUploadId: "upload-catalog-1" },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json<{ error: string }>().error).toBe("catalog-acquisition-unavailable");
    } finally {
      await app.close();
    }
  });
});
