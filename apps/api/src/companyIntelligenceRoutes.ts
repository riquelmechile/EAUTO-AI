import type { FastifyInstance } from "fastify";
import { registerCompanyBrainRoutes } from "./companyBrainRoutes.js";
import { registerCompanyCollaborationRoutes } from "./companyCollaborationRoutes.js";
import { registerCompanyOperationsRoutes } from "./companyOperationsRoutes.js";
import type { CompanyRouteDependencies } from "./companyRouteSupport.js";

export type CompanyIntelligenceRouteDependencies = CompanyRouteDependencies;

export function registerCompanyIntelligenceRoutes(
  app: FastifyInstance,
  dependencies: CompanyIntelligenceRouteDependencies,
): void {
  registerCompanyCollaborationRoutes(app, dependencies);
  registerCompanyBrainRoutes(app, dependencies);
  registerCompanyOperationsRoutes(app, dependencies);
}
