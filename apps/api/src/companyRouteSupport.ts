import type { FastifyRequest } from "fastify";
import { z } from "zod";
import type { ActorIdentity, Permission } from "@eauto/domain";
import type { CompanyIntelligenceRuntime } from "./companyIntelligenceRuntime.js";

export type CompanyRouteDependencies = Readonly<{
  runtime: CompanyIntelligenceRuntime;
  authenticate(request: FastifyRequest): Promise<ActorIdentity>;
  requireAccount(actor: ActorIdentity, accountId: string, permission: Permission): Promise<void>;
}>;

export const accountParamsSchema = z.object({ accountId: z.string().min(3).max(128) });
export const resourceParamsSchema = z.object({
  accountId: z.string().min(3).max(128),
  id: z.string().min(3).max(256),
});
export const listingParamsSchema = z.object({
  accountId: z.string().min(3).max(128),
  listingId: z.string().min(3).max(256),
});
export const limitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1_000).default(100),
});
export const queryBoolean = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return value;
}, z.boolean());
