import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ActorIdentity, Permission, ProductLaunchBrief } from "@eauto/domain";
import type { CompanyIntelligenceRuntime } from "./companyIntelligenceRuntime.js";

export function registerCompanyCreativeRoutes(
  app: FastifyInstance,
  dependencies: Readonly<{
    runtime: CompanyIntelligenceRuntime;
    authenticate(request: FastifyRequest): Promise<ActorIdentity>;
    requireAccount(actor: ActorIdentity, accountId: string, permission: Permission): Promise<void>;
  }>,
): void {
  app.post("/v1/company/:accountId/creative/launches", async (request, reply) => {
    const actor = await dependencies.authenticate(request);
    const params = z.object({ accountId: z.string().min(3).max(128) }).parse(request.params);
    const body = z
      .object({
        productId: z.string().min(3).max(256),
        sourceImageUploadId: z.string().min(3).max(256),
        instructions: z.string().min(3).max(2_000).optional(),
        requestedChannels: z
          .array(z.enum(["mercadolibre", "instagram", "facebook", "tiktok", "owned"]))
          .min(1)
          .max(5),
      })
      .parse(request.body);
    await dependencies.requireAccount(actor, params.accountId, "content.create");
    if (!dependencies.runtime.creativeStudio || !dependencies.runtime.creativeStorage) {
      return reply.code(503).send({
        error: "creative-provider-disabled",
        message: "Configure CONTENT_PROVIDER_KIND=minimax and MINIMAX_API_KEY.",
      });
    }
    const upload = await dependencies.runtime.sourceImageUploads.requireVerified(
      body.sourceImageUploadId,
      actor.organizationId,
      params.accountId,
    );
    const sourceImageUrl = await dependencies.runtime.creativeStorage.createPresignedDownload({
      objectKey: upload.objectKey,
      expiresInSeconds: 900,
    });
    const brief: ProductLaunchBrief = Object.freeze({
      id: body.productId,
      accountId: params.accountId,
      sourceImageUri: sourceImageUrl,
      ...(body.instructions ? { instructions: body.instructions } : {}),
      requestedChannels: Object.freeze(body.requestedChannels),
    });
    const assets = await dependencies.runtime.creativeStudio.createLaunch(brief);
    return reply.code(201).send({
      brief: { ...brief, sourceImageUri: upload.objectUri },
      sourceImageUpload: upload,
      assets,
      requestedBy: actor.id,
      provider: "minimax",
      publicationPerformed: false,
    });
  });
}
