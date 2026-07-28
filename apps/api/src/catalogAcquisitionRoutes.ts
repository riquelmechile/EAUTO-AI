import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CatalogAcquisitionConflictError,
  CatalogAcquisitionUnavailableError,
  CatalogAcquisitionValidationError,
  type ActorIdentity,
  type Permission,
} from "@eauto/domain";
import type { Runtime } from "./runtime.js";

export type CatalogAcquisitionRouteDependencies = Readonly<{
  runtime: Runtime;
  authenticate(request: FastifyRequest): Promise<ActorIdentity>;
  requireAccount(actor: ActorIdentity, accountId: string, permission: Permission): Promise<void>;
}>;

const accountId = z.string().min(3);
const candidateStatus = z.enum(["needs-review", "accepted", "rejected"]);

export function registerCatalogAcquisitionRoutes(
  app: FastifyInstance,
  dependencies: CatalogAcquisitionRouteDependencies,
): void {
  app.post("/v1/catalog-acquisition/discover", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const body = z
      .object({
        accountId,
        sourceImageUploadId: z.string().min(3).max(128),
      })
      .parse(request.body);
    await dependencies.requireAccount(actor, body.accountId, "catalog.acquire");
    if (dependencies.runtime.catalogAcquisitionMode !== "external") {
      return sendCatalogError(new CatalogAcquisitionUnavailableError(), reply);
    }
    try {
      const candidates = await dependencies.runtime.catalogAcquisition.discover({
        organizationId: actor.organizationId,
        accountId: body.accountId,
        sourceImageUploadId: body.sourceImageUploadId,
        policy: dependencies.runtime.catalogAcquisitionPolicy,
      });
      return reply.code(201).send({
        candidates,
        policyVersion: dependencies.runtime.catalogAcquisitionPolicy.policyVersion,
        externalSearchPerformed: true,
      });
    } catch (error) {
      if (isCatalogError(error)) return sendCatalogError(error, reply);
      throw error;
    }
  });

  app.get("/v1/catalog-acquisition/candidates", async (request) => {
    const actor = await dependencies.authenticate(request);
    const query = z
      .object({
        accountId,
        status: candidateStatus.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    await dependencies.requireAccount(actor, query.accountId, "catalog.read");
    const candidates = await dependencies.runtime.catalogAcquisition.listCandidates({
      organizationId: actor.organizationId,
      accountId: query.accountId,
      ...(query.status === undefined ? {} : { status: query.status }),
      limit: query.limit,
    });
    return {
      candidates,
      acquisitionMode: dependencies.runtime.catalogAcquisitionMode,
    };
  });

  app.post("/v1/catalog-acquisition/candidates/:id/review", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = z.object({ id: z.string().min(3).max(128) }).parse(request.params);
    const body = z
      .object({
        accountId,
        decision: z.enum(["accepted", "rejected"]),
        note: z.string().max(1_000).nullable().optional(),
      })
      .parse(request.body);
    await dependencies.requireAccount(actor, body.accountId, "catalog.review");
    try {
      const candidate = await dependencies.runtime.catalogAcquisition.reviewCandidate({
        id: params.id,
        organizationId: actor.organizationId,
        accountId: body.accountId,
        decision: body.decision,
        reviewedBy: actor.id,
        ...(body.note === undefined ? {} : { note: body.note }),
      });
      if (!candidate) {
        return reply.code(404).send({
          error: "not-found",
          message: "Catalog acquisition candidate not found.",
        });
      }
      return candidate;
    } catch (error) {
      if (isCatalogError(error)) return sendCatalogError(error, reply);
      throw error;
    }
  });
}

function isCatalogError(
  error: unknown,
): error is
  | CatalogAcquisitionValidationError
  | CatalogAcquisitionConflictError
  | CatalogAcquisitionUnavailableError {
  return (
    error instanceof CatalogAcquisitionValidationError ||
    error instanceof CatalogAcquisitionConflictError ||
    error instanceof CatalogAcquisitionUnavailableError
  );
}

function sendCatalogError(
  error:
    | CatalogAcquisitionValidationError
    | CatalogAcquisitionConflictError
    | CatalogAcquisitionUnavailableError,
  reply: FastifyReply,
) {
  const status =
    error instanceof CatalogAcquisitionUnavailableError
      ? 503
      : error instanceof CatalogAcquisitionConflictError
        ? 409
        : 400;
  return reply.code(status).send({ error: error.code, message: error.message });
}
