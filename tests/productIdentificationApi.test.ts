import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createProductIdentificationArtifact } from "@eauto/application";
import type {
  ProductIdentificationResult,
  SourceImageUpload,
  StoredProductIdentification,
} from "@eauto/domain";
import { buildApp } from "../apps/api/src/app.js";
import { hashToken } from "../apps/api/src/auth.js";
import { loadConfig } from "../apps/api/src/config.js";
import { createRuntime } from "../apps/api/src/runtime.js";

const tokens = Object.freeze({
  viewer: "product-viewer-secret",
  reviewer: "product-reviewer-secret",
  operator: "product-operator-secret",
});
const config = loadConfig({
  NODE_ENV: "test",
  AUTH_MODE: "static-token",
  OPERATOR_TOKENS_JSON: JSON.stringify([
    {
      id: "product-viewer",
      tokenHash: hashToken(tokens.viewer),
      organizationId: "maustian",
      roles: ["viewer"],
      accountIds: ["plasticov"],
    },
    {
      id: "product-reviewer",
      tokenHash: hashToken(tokens.reviewer),
      organizationId: "maustian",
      roles: ["reviewer"],
      accountIds: ["plasticov"],
    },
    {
      id: "product-operator",
      tokenHash: hashToken(tokens.operator),
      organizationId: "maustian",
      roles: ["operator"],
      accountIds: ["plasticov"],
    },
  ]),
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

async function seedVerifiedUpload(runtime: ReturnType<typeof createRuntime>, uploadId: string) {
  const createdAt = new Date(Date.now() - 120_000).toISOString();
  const verifiedAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  const common = Object.freeze({
    id: uploadId,
    organizationId: "maustian",
    accountId: "plasticov",
    objectKey: `organizations/maustian/accounts/plasticov/source-images/${uploadId}.jpg`,
    originalFileName: "product.jpg",
    contentType: "image/jpeg" as const,
    sizeBytes: 1_024,
    checksumSha256Base64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    createdAt,
    expiresAt,
  });
  const requested: SourceImageUpload = Object.freeze({
    ...common,
    status: "requested",
    objectUri: null,
    verifiedAt: null,
    rejectionReason: null,
  });
  const verified: SourceImageUpload = Object.freeze({
    ...common,
    status: "verified",
    objectUri: `s3://eauto-content/${common.objectKey}`,
    verifiedAt,
    rejectionReason: null,
  });
  await runtime.sourceImages.save(requested);
  await runtime.sourceImages.save(verified);
}

function clearIdentification(): StoredProductIdentification {
  const evaluatedAt = new Date(Date.now() - 60_000).toISOString();
  const evidenceRef = "source-image:review-upload:checksum";
  const result: ProductIdentificationResult = Object.freeze({
    organizationId: "maustian",
    accountId: "plasticov",
    sourceImageUploadId: "review-upload",
    status: "identified-pending-confirmation",
    selectedCandidate: Object.freeze({
      id: "candidate-clear",
      canonicalName: "Esquiladora inalámbrica",
      brand: null,
      model: null,
      categoryHint: "Herramientas",
      confidenceBps: 9_500,
      evidenceRefs: Object.freeze([evidenceRef]),
    }),
    alternativeCandidates: Object.freeze([]),
    blockingDuplicate: null,
    reasons: Object.freeze([]),
    evidenceRefs: Object.freeze([evidenceRef]),
    policyVersion: "catalog-acquisition-v1:product-identification-v1",
    requiresHumanConfirmation: true,
    evaluatedAt,
  });
  return createProductIdentificationArtifact(
    result,
    Object.freeze({
      algorithm: "sha256-prefix-64",
      version: "deterministic-sha256-prefix-v1",
      value: "0".repeat(64),
      evidenceRef,
    }),
  );
}

describe("Product Identification API", () => {
  it("allows an operator to identify and a viewer to read the canonical result", async () => {
    const runtime = createRuntime(config);
    await seedVerifiedUpload(runtime, "identify-upload");
    const app = await buildApp(config, runtime);
    try {
      const operatorToken = await enroll(app, tokens.operator);
      const identified = await app.inject({
        method: "POST",
        url: "/v1/product-identification/identify",
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: { accountId: "plasticov", sourceImageUploadId: "identify-upload" },
      });
      expect(identified.statusCode).toBe(201);
      const payload = identified.json<{
        identification: StoredProductIdentification;
        mode: string;
        fingerprintMode: string;
        policyVersion: string;
      }>();
      expect(payload.identification.id).toMatch(/^product_identification_[a-f0-9]{64}$/);
      expect(payload.identification.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(payload.identification.result.status).toBe("no-match");
      expect(payload.mode).toBe("deterministic-development");
      expect(payload.fingerprintMode).toBe("deterministic-sha256-prefix");
      expect(payload.identification.fingerprint.algorithm).toBe("sha256-prefix-64");
      expect(payload.policyVersion).toContain("product-identification-v1");

      const viewerToken = await enroll(app, tokens.viewer);
      const read = await app.inject({
        method: "GET",
        url: `/v1/product-identification/${payload.identification.id}?accountId=plasticov`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(read.statusCode).toBe(200);
      expect(read.json<StoredProductIdentification>()).toEqual(payload.identification);

      const forbiddenIdentify = await app.inject({
        method: "POST",
        url: "/v1/product-identification/identify",
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: { accountId: "plasticov", sourceImageUploadId: "identify-upload" },
      });
      expect(forbiddenIdentify.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("uses server-owned reviewer metadata and rejects a contradictory terminal decision", async () => {
    const runtime = createRuntime(config);
    const identification = clearIdentification();
    await runtime.productIdentifications.save(identification);
    const app = await buildApp(config, runtime);
    try {
      const reviewerToken = await enroll(app, tokens.reviewer);
      const first = await app.inject({
        method: "POST",
        url: `/v1/product-identification/${identification.id}/review`,
        headers: { authorization: `Bearer ${reviewerToken}` },
        payload: {
          accountId: "plasticov",
          decision: "confirmed",
          candidateId: "candidate-clear",
          productId: "catalog-product-1",
          reviewerId: "attacker-controlled",
          decidedAt: "2000-01-01T00:00:00.000Z",
        },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({
        identificationId: identification.id,
        reviewerId: "product-reviewer",
        decision: "confirmed",
        productId: "catalog-product-1",
      });
      expect(new Date(first.json<{ decidedAt: string }>().decidedAt).getTime()).toBeGreaterThan(
        new Date(identification.result.evaluatedAt).getTime(),
      );

      const conflict = await app.inject({
        method: "POST",
        url: `/v1/product-identification/${identification.id}/review`,
        headers: { authorization: `Bearer ${reviewerToken}` },
        payload: {
          accountId: "plasticov",
          decision: "rejected",
          candidateId: "candidate-clear",
          reason: "Contradictory decision",
        },
      });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json<{ error: string }>().error).toBe("product-identification-conflict");

      const viewerToken = await enroll(app, tokens.viewer);
      const forbiddenReview = await app.inject({
        method: "POST",
        url: `/v1/product-identification/${identification.id}/review`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: {
          accountId: "plasticov",
          decision: "rejected",
          candidateId: "candidate-clear",
          reason: "Viewer cannot review",
        },
      });
      expect(forbiddenReview.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});
