import type { Pool } from "pg";
import {
  FreshMercadoLibreTaxonomyReader,
  MercadoLibreTaxonomyPreflightService,
} from "@eauto/application";
import type { MercadoLibreTaxonomyPolicy } from "@eauto/domain";
import {
  MercadoLibreTaxonomyHttpReader,
  PostgresMercadoLibreTaxonomySnapshotRepository,
} from "@eauto/infrastructure";

export const MERCADOLIBRE_TAXONOMY_POLICY: MercadoLibreTaxonomyPolicy = Object.freeze({
  siteId: "MLC",
  maximumEvidenceAgeMs: 86_400_000,
  policyVersion: "mercadolibre-taxonomy-v1",
});

export type MercadoLibreTaxonomyRuntime = Readonly<{
  preflight: Pick<MercadoLibreTaxonomyPreflightService, "preflight">;
  policy: MercadoLibreTaxonomyPolicy;
  mode: "official-http-postgres-cache";
}>;

export function createMercadoLibreTaxonomyRuntime(
  pool: Pool | null,
  now: () => Date = () => new Date(),
): MercadoLibreTaxonomyRuntime | null {
  if (!pool) return null;

  const store = new PostgresMercadoLibreTaxonomySnapshotRepository(pool);
  const source = new MercadoLibreTaxonomyHttpReader(
    Object.freeze({
      apiBaseUrl: "https://api.mercadolibre.com",
      timeoutMs: 15_000,
      maximumResponseBytes: 1_048_576,
    }),
    now,
  );
  const taxonomy = new FreshMercadoLibreTaxonomyReader(
    store,
    source,
    MERCADOLIBRE_TAXONOMY_POLICY.maximumEvidenceAgeMs,
    now,
  );

  return Object.freeze({
    preflight: new MercadoLibreTaxonomyPreflightService(taxonomy, now),
    policy: MERCADOLIBRE_TAXONOMY_POLICY,
    mode: "official-http-postgres-cache",
  });
}
