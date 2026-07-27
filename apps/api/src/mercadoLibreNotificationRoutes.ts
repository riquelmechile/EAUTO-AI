import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ActorIdentity, Permission } from "@eauto/domain";
import type { Runtime } from "./runtime.js";

const webhookSchema = z.object({
  _id: z.union([z.string(), z.number()]).transform(String),
  resource: z.string().min(1).max(2_000),
  user_id: z.union([z.string(), z.number()]).transform(String),
  topic: z.string().min(1).max(100),
  application_id: z.union([z.string(), z.number()]).transform(String),
  attempts: z.number().int().nonnegative().optional(),
  sent: z.string().optional(),
  received: z.string().optional(),
});

export type MercadoLibreNotificationRouteDependencies = Readonly<{
  runtime: Runtime;
  webhookToken: string | null;
  authenticate(request: FastifyRequest): Promise<ActorIdentity>;
  requireAccount(actor: ActorIdentity, accountId: string, permission: Permission): Promise<void>;
}>;

export function registerMercadoLibreNotificationRoutes(
  app: FastifyInstance,
  dependencies: MercadoLibreNotificationRouteDependencies,
): void {
  app.post("/v1/webhooks/mercadolibre", async (request) => {
    const service = dependencies.runtime.mercadoLibreNotificationIngestion;
    const query = z.object({ token: z.string().optional() }).safeParse(request.query);
    if (
      !service ||
      !dependencies.webhookToken ||
      !query.success ||
      !secureEquals(query.data.token ?? "", dependencies.webhookToken)
    ) {
      return { ok: true, queued: false };
    }
    const body = webhookSchema.parse(request.body);
    const result = await service.ingest({
      notificationId: body._id,
      applicationId: body.application_id,
      sellerId: body.user_id,
      topic: body.topic,
      resource: body.resource,
      ...(body.sent ? { sentAt: body.sent } : {}),
      ...(body.received ? { receivedAt: body.received } : {}),
      ...(body.attempts === undefined ? {} : { attempts: body.attempts }),
    });
    return { ok: true, queued: result.accepted && !result.duplicate };
  });

  app.get("/v1/operations/mercadolibre-notifications/:accountId/stats", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = z.object({ accountId: z.string().min(3) }).parse(request.params);
    await dependencies.requireAccount(actor, params.accountId, "operations.read");
    return {
      stats: await dependencies.runtime.mercadoLibreNotifications.stats(params.accountId),
    };
  });

  app.get("/v1/operations/mercadolibre-notifications/:accountId/dead", async (request) => {
    const actor = await dependencies.authenticate(request);
    const params = z.object({ accountId: z.string().min(3) }).parse(request.params);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(25) })
      .parse(request.query);
    await dependencies.requireAccount(actor, params.accountId, "operations.read");
    return {
      notifications: await dependencies.runtime.mercadoLibreNotifications.listDead(
        params.accountId,
        query.limit,
      ),
    };
  });

  app.post(
    "/v1/operations/mercadolibre-notifications/:accountId/dead/:id/requeue",
    async (request, reply) => {
      const actor = await dependencies.authenticate(request);
      const params = z
        .object({ accountId: z.string().min(3), id: z.string().min(3) })
        .parse(request.params);
      await dependencies.requireAccount(actor, params.accountId, "operations.manage");
      const requeued = await dependencies.runtime.mercadoLibreNotifications.requeueDead({
        id: params.id,
        accountId: params.accountId,
        availableAt: new Date(),
      });
      if (!requeued) return reply.code(404).send({ error: "not-found" });
      return { requeued: true };
    },
  );
}

function secureEquals(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left, "utf8").digest();
  const rightHash = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftHash, rightHash);
}
