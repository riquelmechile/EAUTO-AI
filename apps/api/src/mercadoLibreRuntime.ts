import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { MercadoLibreIntegrationService } from "@eauto/application";
import {
  InMemoryMercadoLibreConnectionRepository,
  InMemoryMercadoLibreListingSnapshotRepository,
  InMemoryMercadoLibreOAuthStateRepository,
  NodePkce,
  NodeSecretVault,
  PostgresMercadoLibreConnectionRepository,
  PostgresMercadoLibreListingSnapshotRepository,
  PostgresMercadoLibreOAuthStateRepository,
} from "@eauto/infrastructure";
import { MercadoLibreHttpClient } from "./mercadoLibreClient.js";
import type { AppConfig } from "./config.js";

export type MercadoLibreRuntime = Readonly<{
  enabled: boolean;
  service: MercadoLibreIntegrationService | null;
  close(): Promise<void>;
}>;

export function createMercadoLibreRuntime(config: AppConfig): MercadoLibreRuntime {
  if (!config.MERCADOLIBRE_ENABLED) {
    return Object.freeze({
      enabled: false,
      service: null,
      close: () => Promise.resolve(),
    });
  }

  const credentials = requireCredentials(config);
  const pool = config.DATABASE_URL ? new Pool({ connectionString: config.DATABASE_URL }) : null;
  const states = pool
    ? new PostgresMercadoLibreOAuthStateRepository(pool)
    : new InMemoryMercadoLibreOAuthStateRepository();
  const connections = pool
    ? new PostgresMercadoLibreConnectionRepository(pool)
    : new InMemoryMercadoLibreConnectionRepository();
  const snapshots = pool
    ? new PostgresMercadoLibreListingSnapshotRepository(pool)
    : new InMemoryMercadoLibreListingSnapshotRepository();
  const service = new MercadoLibreIntegrationService(
    states,
    connections,
    snapshots,
    new NodeSecretVault(credentials.vaultKeyBase64),
    new NodePkce(),
    new MercadoLibreHttpClient({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      redirectUri: credentials.redirectUri,
      authorizationBaseUrl: config.MERCADOLIBRE_AUTHORIZATION_BASE_URL,
      apiBaseUrl: config.MERCADOLIBRE_API_BASE_URL,
      timeoutMs: config.MERCADOLIBRE_HTTP_TIMEOUT_MS,
      maximumScanPages: config.MERCADOLIBRE_MAXIMUM_SCAN_PAGES,
    }),
    { now: () => new Date() },
    { next: (prefix: string) => `${prefix}_${randomUUID()}` },
    {
      stateTtlMs: config.MERCADOLIBRE_STATE_TTL_MS,
      refreshLeaseMs: config.MERCADOLIBRE_REFRESH_LEASE_MS,
      refreshBeforeExpiryMs: config.MERCADOLIBRE_REFRESH_BEFORE_EXPIRY_MS,
    },
  );

  return Object.freeze({
    enabled: true,
    service,
    close: () => pool?.end() ?? Promise.resolve(),
  });
}

function requireCredentials(config: AppConfig): Readonly<{
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  vaultKeyBase64: string;
}> {
  if (
    !config.MERCADOLIBRE_CLIENT_ID ||
    !config.MERCADOLIBRE_CLIENT_SECRET ||
    !config.MERCADOLIBRE_REDIRECT_URI ||
    !config.MERCADOLIBRE_VAULT_KEY_BASE64
  ) {
    throw new Error("Mercado Libre integration is enabled without complete credentials.");
  }
  return Object.freeze({
    clientId: config.MERCADOLIBRE_CLIENT_ID,
    clientSecret: config.MERCADOLIBRE_CLIENT_SECRET,
    redirectUri: config.MERCADOLIBRE_REDIRECT_URI,
    vaultKeyBase64: config.MERCADOLIBRE_VAULT_KEY_BASE64,
  });
}
