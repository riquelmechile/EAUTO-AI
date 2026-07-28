import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ActorIdentity, Permission } from "@eauto/domain";
import type { Runtime } from "./runtime.js";

export type ProductIdentificationRouteDependencies = Readonly<{
  runtime: Runtime;
  authenticate(request: FastifyRequest): Promise<ActorIdentity>;
  requireAccount(actor: ActorIdentity, accountId: string, permission: Permission): Promise<void>;
}>;

const accountId = z.string().min(3);
const identificationId = z.string().min(32).max(256);
const reviewBody = z.discriminatedUnion("decision", [
  z.object({
    accountId,
    decision: z.literal("confirmed"),
    candidateId: z.string().min(1).max(256),
    productId: z.string().min(1).max(256),
    reason: z.string().max(1_000).nullable().optional(),
  }),
  z.object({
    accountId,
    decision: z.literal("rejected"),
    candidateId: z.string().min(1).max(256),
    productId: z.null().optional(),
    reason: z.string().min(1).max(1_000),
  }),
]);

export function registerProductIdentificationRoutes(
  app: FastifyInstance,
  dependencies: ProductIdentificationRouteDependencies,
): void {
  app.post("/v1/product-identification/identify", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const body = z
      .object({
        accountId,
        sourceImageUploadId: z.string().min(3).max(128),
      })
      .parse(request.body);
    await dependencies.requireAccount(actor, body.accountId, "catalog.acquire");
    if (dependencies.runtime.productIdentificationMode === "disabled") {
      return sendError(
        503,
        "product-identification-unavailable",
        "Product identification is disabled.",
        reply,
      );
    }
    try {
      const identification =
        await dependencies.runtime.productIdentification.identifyStoredFromPhoto({
          organizationId: actor.organizationId,
          accountId: body.accountId,
          sourceImageUploadId: body.sourceImageUploadId,
          policy: dependencies.runtime.productIdentificationPolicy,
        });
      return reply.code(201).send({
        identification,
        mode: dependencies.runtime.productIdentificationMode,
        fingerprintMode: dependencies.runtime.productFingerprintMode,
        policyVersion: dependencies.runtime.productIdentificationPolicy.policyVersion,
      });
    } catch (error) {
      return sendProductIdentificationError(error, reply);
    }
  });

  app.get("/v1/product-identification/:id", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = z.object({ id: identificationId }).parse(request.params);
    const query = z.object({ accountId }).parse(request.query);
    await dependencies.requireAccount(actor, query.accountId, "catalog.read");
    const stored = await dependencies.runtime.productIdentifications.get({
      organizationId: actor.organizationId,
      accountId: query.accountId,
      identificationId: params.id,
    });
    if (!stored) {
      return sendError(
        404,
        "product-identification-not-found",
        "Product identification not found.",
        reply,
      );
    }
    return stored;
  });

  app.post("/v1/product-identification/:id/review", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = z.object({ id: identificationId }).parse(request.params);
    const body = reviewBody.parse(request.body);
    await dependencies.requireAccount(actor, body.accountId, "catalog.review");
    try {
      const review = await dependencies.runtime.productIdentificationReview.review({
        reviewId: `product_identification_review_${randomUUID()}`,
        organizationId: actor.organizationId,
        accountId: body.accountId,
        identificationId: params.id,
        candidateId: body.candidateId,
        productId: body.decision === "confirmed" ? body.productId : null,
        decision: body.decision,
        reviewerId: actor.id,
        reason: body.reason ?? null,
        decidedAt: new Date().toISOString(),
      });
      return review;
    } catch (error) {
      return sendProductIdentificationError(error, reply);
    }
  });
}

function sendProductIdentificationError(error: unknown, reply: FastifyReply) {
  const message = error instanceof Error ? error.message : "Product identification failed.";
  if (message.includes("was not found")) {
    return sendError(404, "product-identification-not-found", message, reply);
  }
  if (
    message.includes("already terminal") ||
    message.includes("idempotency conflict") ||
    message.includes("changed before review") ||
    message.includes("already has a different")
  ) {
    return sendError(409, "product-identification-conflict", message, reply);
  }
  return sendError(400, "product-identification-validation", message, reply);
}

function sendError(status: number, error: string, message: string, reply: FastifyReply) {
  return reply.code(status).send({ error, message });
}
