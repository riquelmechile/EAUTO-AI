import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

async function source(path: string): Promise<string> {
  return readFile(resolve(root, path), "utf8");
}

describe("Android company control contract", () => {
  it("keeps every mobile company-intelligence operation backed by an API route", async () => {
    const [mobile, brainRoutes, operationRoutes, creativeRoutes] = await Promise.all([
      source("apps/mobile/src/lib/agentOsApi.ts"),
      source("apps/api/src/companyBrainRoutes.ts"),
      source("apps/api/src/companyOperationsRoutes.ts"),
      source("apps/api/src/companyCreativeRoutes.ts"),
    ]);

    const contracts = [
      {
        mobile: "/brain`",
        backend: '"/v1/company/:accountId/brain"',
        source: brainRoutes,
      },
      {
        mobile: "/brain/rebuild`",
        backend: '"/v1/company/:accountId/brain/rebuild"',
        source: brainRoutes,
      },
      {
        mobile: "/daemons/initialize`",
        backend: '"/v1/company/:accountId/daemons/initialize"',
        source: operationRoutes,
      },
      {
        mobile: "/daemons`",
        backend: '"/v1/company/:accountId/daemons"',
        source: operationRoutes,
      },
      {
        mobile: "/supply/workflows?limit=50`",
        backend: '"/v1/company/:accountId/supply/workflows"',
        source: operationRoutes,
      },
      {
        mobile: "/lifecycle?limit=100`",
        backend: '"/v1/company/:accountId/lifecycle"',
        source: operationRoutes,
      },
      {
        mobile: "/creative/launches`",
        backend: '"/v1/company/:accountId/creative/launches"',
        source: creativeRoutes,
      },
    ] as const;

    for (const contract of contracts) {
      expect(mobile, `missing mobile route fragment ${contract.mobile}`).toContain(contract.mobile);
      expect(contract.source, `missing backend route ${contract.backend}`).toContain(
        contract.backend,
      );
    }
  });

  it("routes Content Studio through the governed MiniMax company client", async () => {
    const screen = await source("apps/mobile/src/features/content-studio/ContentStudioScreen.tsx");
    expect(screen).toContain('agentOsApi.createCreativeLaunch("plasticov"');
    expect(screen).not.toContain("api.createLaunch(");
    expect(screen).toContain("No crea publicaciones ni modifica MercadoLibre");
  });

  it("keeps the company routes registered in the production application", async () => {
    const companyApp = await source("apps/api/src/companyApp.ts");
    expect(companyApp).toContain("registerCompanyIntelligenceRoutes(app, routeDependencies)");
    expect(companyApp).toContain("registerCompanyCreativeRoutes(app, routeDependencies)");
  });
});
