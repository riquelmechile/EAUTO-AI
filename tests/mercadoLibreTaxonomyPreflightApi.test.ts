import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  MercadoLibreIntegrationError,
  type ActorIdentity,
  type Permission,
} from "@eauto/domain";
import { loadConfig } from "../apps/api/src/config.js";
import { registerMercadoLibreRoutes } from "../apps/api/src/mercadoLibreRoutes.js";
import {
  MERCADOLIBRE_TAXONOMY_POLICY,
  type MercadoLibreTaxonomyRuntime,
} from "../apps/api/src/mercadoLibreTaxonomyRuntime.js";
import { createRuntime } from "../apps/api/src/runtime.js";

const actor: ActorIdentity = Object.freeze({
  id: "taxonomy-viewer",
  organizationId: "maustian",
  roles: Object.freeze(["viewer"]),
  accountIds: Object.freeze(["plasticov"]),
});

function result() {
  return Object.freeze({
    status: "ready" as const,
    categoryId: "MLC1234",
    reasons: Object.freeze([]),
    missingRequiredAttributeIds: Object.freeze([]),
    invalidAttributeIds: Object.freeze([]),
    evidenceRefs: Object.freeze([
      `mercadolibre-category:MLC1234:${"a".repeat(64)}`,
      `mercadolibre-category-attributes:MLC1234:${"b".repeat(64)}`,
    ]),
    policyVersion: MERCADOLIBRE_TAXONOMY_POLICY.policyVersion,
    evaluatedAt: "2026-07-28T18:00:00.000Z",
  });
}

async function createTestApp(taxonomyRuntime?: MercadoLibreTaxonomyRuntime) {
  const runtime = createRuntime(loadConfig({ NODE_ENV: "test", AUTH_MODE: "disabled" }));
  const app = Fastify();
  const requireAccount = vi.fn(
    async (
      receivedActor: ActorIdentity,
      accountId: string,
      permission: Permission,
    ): Promise<void> => {
      expect(receivedActor).toBe(actor);
      expect(accountId).toBe("plasticov");
      expect(permission).toBe("integrations.read");
    },
  );
  registerMercadoLibreRoutes(app, {
    runtime,
    webhookToken: null,
    ...(taxonomyRuntime ? { taxonomyRuntime } : {}),
    authenticate: () => Promise.resolve(actor),
    requireAccount,
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      void reply.code(400).send({ error: "validation-error", issues: error.issues });
      return;
    }
    if (error instanceof MercadoLibreIntegrationError) {
      void reply.code(409).send({ error: error.code, message: error.message });
      return;
    }
    void reply.code(500).send({ error: "internal-error" });
  });
  return { app, runtime, requireAccount };
}

describe("MercadoLibre taxonomy preflight API", () => {
  it("uses authenticated tenant scope and a server-owned policy without performing writes", async () => {
    const preflight = vi
      .fn<MercadoLibreTaxonomyRuntime["preflight"]["preflight"]>()
      .mockResolvedValue(result());
    const taxonomyRuntime: MercadoLibreTaxonomyRuntime = Object.freeze({
      preflight: Object.freeze({ preflight }),
      policy: MERCADOLIBRE_TAXONOMY_POLICY,
      mode: "official-http-postgres-cache",
    });
    const { app, runtime, requireAccount } = await createTestApp(taxonomyRuntime);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/integrations/mercadolibre/plasticov/taxonomy/preflight",
        payload: {
          categoryId: "MLC1234",
          submittedAttributes: [
            { id: "ITEM_CONDITION", valueId: "2230284", valueName: null },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: "ready",
        categoryId: "MLC1234",
        policyVersion: "mercadolibre-taxonomy-v1",
        writesPerformed: false,
      });
      expect(requireAccount).toHaveBeenCalledTimes(1);
      expect(preflight).toHaveBeenCalledWith({
        organizationId: "maustian",
        accountId: "plasticov",
        categoryId: "MLC1234",
        submittedAttributes: [
          { id: "ITEM_CONDITION", valueId: "2230284", valueName: null },
        ],
        policy: MERCADOLIBRE_TAXONOMY_POLICY,
      });
    } finally {
      await app.close();
      await runtime.close();
    }
  });

  it("rejects request attempts to inject a taxonomy policy", async () => {
    const preflight = vi
      .fn<MercadoLibreTaxonomyRuntime["preflight"]["preflight"]>()
      .mockResolvedValue(result());
    const { app, runtime } = await createTestApp(
      Object.freeze({
        preflight: Object.freeze({ preflight }),
        policy: MERCADOLIBRE_TAXONOMY_POLICY,
        mode: "official-http-postgres-cache",
      }),
    );

    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/integrations/mercadolibre/plasticov/taxonomy/preflight",
        payload: {
          categoryId: "MLC1234",
          submittedAttributes: [],
          policy: { maximumEvidenceAgeMs: Number.MAX_SAFE_INTEGER, policyVersion: "attacker" },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(preflight).not.toHaveBeenCalled();
    } finally {
      await app.close();
      await runtime.close();
    }
  });

  it("fails closed when durable PostgreSQL taxonomy persistence is unavailable", async () => {
    const { app, runtime } = await createTestApp();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/integrations/mercadolibre/plasticov/taxonomy/preflight",
        payload: { categoryId: "MLC1234", submittedAttributes: [] },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        error: "mercadolibre-taxonomy-unavailable",
        message: "MercadoLibre taxonomy preflight requires durable PostgreSQL persistence.",
      });
    } finally {
      await app.close();
      await runtime.close();
    }
  });
});
