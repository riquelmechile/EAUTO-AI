import type { Pool } from "pg";
import type {
  MercadoLibreConnection,
  MercadoLibreListingSnapshot,
  MercadoLibreOAuthState,
} from "@eauto/domain";
import type {
  MercadoLibreConnectionRepository,
  MercadoLibreListingSnapshotRepository,
  MercadoLibreOAuthStateRepository,
} from "@eauto/application";

type OAuthStateRow = {
  state_hash: string;
  organization_id: string;
  account_id: string;
  actor_id: string;
  code_verifier_ciphertext: string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
  created_at: Date | string;
};

type ConnectionRow = {
  account_id: string;
  organization_id: string;
  mercado_libre_user_id: string | number;
  site_id: string;
  nickname: string;
  status: MercadoLibreConnection["status"];
  access_token_ciphertext: string;
  refresh_token_ciphertext: string;
  access_expires_at: Date | string;
  token_version: number;
  last_synced_at: Date | string | null;
  last_error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type SnapshotRow = {
  account_id: string;
  organization_id: string;
  mercado_libre_user_id: string | number;
  item_ids_json: readonly string[];
  total: number;
  synced_at: Date | string;
};

export class PostgresMercadoLibreOAuthStateRepository
  implements MercadoLibreOAuthStateRepository
{
  constructor(private readonly pool: Pool) {}

  async save(state: MercadoLibreOAuthState): Promise<void> {
    await this.pool.query(
      `INSERT INTO mercadolibre_oauth_states
        (state_hash, organization_id, account_id, actor_id, code_verifier_ciphertext,
         expires_at, consumed_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        state.stateHash,
        state.organizationId,
        state.accountId,
        state.actorId,
        state.codeVerifierCiphertext,
        state.expiresAt,
        state.consumedAt,
        state.createdAt,
      ],
    );
  }

  async consume(stateHash: string, consumedAt: string): Promise<MercadoLibreOAuthState | null> {
    const result = await this.pool.query<OAuthStateRow>(
      `UPDATE mercadolibre_oauth_states
       SET consumed_at = $2
       WHERE state_hash = $1
         AND consumed_at IS NULL
         AND expires_at > $2
       RETURNING state_hash, organization_id, account_id, actor_id,
         code_verifier_ciphertext, expires_at, consumed_at, created_at`,
      [stateHash, consumedAt],
    );
    const row = result.rows[0];
    return row ? mapOAuthState(row) : null;
  }
}

export class PostgresMercadoLibreConnectionRepository
  implements MercadoLibreConnectionRepository
{
  constructor(private readonly pool: Pool) {}

  async save(connection: MercadoLibreConnection): Promise<void> {
    await this.pool.query(
      `INSERT INTO mercadolibre_connections
        (account_id, organization_id, mercado_libre_user_id, site_id, nickname, status,
         access_token_ciphertext, refresh_token_ciphertext, access_expires_at, token_version,
         last_synced_at, last_error, refresh_locked_by, refresh_locked_until, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL, NULL, $13, $14)
       ON CONFLICT (account_id) DO UPDATE SET
         organization_id = EXCLUDED.organization_id,
         mercado_libre_user_id = EXCLUDED.mercado_libre_user_id,
         site_id = EXCLUDED.site_id,
         nickname = EXCLUDED.nickname,
         status = EXCLUDED.status,
         access_token_ciphertext = EXCLUDED.access_token_ciphertext,
         refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
         access_expires_at = EXCLUDED.access_expires_at,
         token_version = EXCLUDED.token_version,
         last_synced_at = EXCLUDED.last_synced_at,
         last_error = EXCLUDED.last_error,
         refresh_locked_by = NULL,
         refresh_locked_until = NULL,
         updated_at = EXCLUDED.updated_at`,
      [
        connection.accountId,
        connection.organizationId,
        connection.mercadoLibreUserId,
        connection.siteId,
        connection.nickname,
        connection.status,
        connection.accessTokenCiphertext,
        connection.refreshTokenCiphertext,
        connection.accessExpiresAt,
        connection.tokenVersion,
        connection.lastSyncedAt,
        connection.lastError,
        connection.createdAt,
        connection.updatedAt,
      ],
    );
  }

  async get(accountId: string): Promise<MercadoLibreConnection | null> {
    const result = await this.pool.query<ConnectionRow>(
      `SELECT account_id, organization_id, mercado_libre_user_id, site_id, nickname, status,
         access_token_ciphertext, refresh_token_ciphertext, access_expires_at, token_version,
         last_synced_at, last_error, created_at, updated_at
       FROM mercadolibre_connections WHERE account_id = $1`,
      [accountId],
    );
    const row = result.rows[0];
    return row ? mapConnection(row) : null;
  }

  async claimRefresh(input: {
    accountId: string;
    workerId: string;
    now: string;
    lockedUntil: string;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE mercadolibre_connections
       SET refresh_locked_by = $2, refresh_locked_until = $4
       WHERE account_id = $1
         AND (refresh_locked_until IS NULL OR refresh_locked_until <= $3)`,
      [input.accountId, input.workerId, input.now, input.lockedUntil],
    );
    return result.rowCount === 1;
  }

  async saveRefreshed(input: {
    connection: MercadoLibreConnection;
    workerId: string;
    expectedTokenVersion: number;
  }): Promise<boolean> {
    const connection = input.connection;
    const result = await this.pool.query(
      `UPDATE mercadolibre_connections
       SET access_token_ciphertext = $4,
           refresh_token_ciphertext = $5,
           access_expires_at = $6,
           token_version = $7,
           status = $8,
           last_error = NULL,
           refresh_locked_by = NULL,
           refresh_locked_until = NULL,
           updated_at = $9
       WHERE account_id = $1
         AND refresh_locked_by = $2
         AND token_version = $3`,
      [
        connection.accountId,
        input.workerId,
        input.expectedTokenVersion,
        connection.accessTokenCiphertext,
        connection.refreshTokenCiphertext,
        connection.accessExpiresAt,
        connection.tokenVersion,
        connection.status,
        connection.updatedAt,
      ],
    );
    return result.rowCount === 1;
  }

  async releaseRefresh(input: {
    accountId: string;
    workerId: string;
    lastError: string;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE mercadolibre_connections
       SET status = 'error',
           last_error = $3,
           refresh_locked_by = NULL,
           refresh_locked_until = NULL,
           updated_at = now()
       WHERE account_id = $1 AND refresh_locked_by = $2`,
      [input.accountId, input.workerId, input.lastError],
    );
  }
}

export class PostgresMercadoLibreListingSnapshotRepository
  implements MercadoLibreListingSnapshotRepository
{
  constructor(private readonly pool: Pool) {}

  async save(snapshot: MercadoLibreListingSnapshot): Promise<void> {
    await this.pool.query(
      `INSERT INTO mercadolibre_listing_snapshots
        (account_id, organization_id, mercado_libre_user_id, item_ids_json, total, synced_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       ON CONFLICT (account_id) DO UPDATE SET
         organization_id = EXCLUDED.organization_id,
         mercado_libre_user_id = EXCLUDED.mercado_libre_user_id,
         item_ids_json = EXCLUDED.item_ids_json,
         total = EXCLUDED.total,
         synced_at = EXCLUDED.synced_at`,
      [
        snapshot.accountId,
        snapshot.organizationId,
        snapshot.mercadoLibreUserId,
        JSON.stringify(snapshot.itemIds),
        snapshot.total,
        snapshot.syncedAt,
      ],
    );
  }

  async get(accountId: string): Promise<MercadoLibreListingSnapshot | null> {
    const result = await this.pool.query<SnapshotRow>(
      `SELECT account_id, organization_id, mercado_libre_user_id, item_ids_json, total, synced_at
       FROM mercadolibre_listing_snapshots WHERE account_id = $1`,
      [accountId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return Object.freeze({
      accountId: row.account_id,
      organizationId: row.organization_id,
      mercadoLibreUserId: Number(row.mercado_libre_user_id),
      itemIds: Object.freeze([...row.item_ids_json]),
      total: row.total,
      syncedAt: toIso(row.synced_at),
      source: "mercadolibre-users-items-search",
    });
  }
}

function mapOAuthState(row: OAuthStateRow): MercadoLibreOAuthState {
  return Object.freeze({
    stateHash: row.state_hash,
    organizationId: row.organization_id,
    accountId: row.account_id,
    actorId: row.actor_id,
    codeVerifierCiphertext: row.code_verifier_ciphertext,
    expiresAt: toIso(row.expires_at),
    consumedAt: row.consumed_at === null ? null : toIso(row.consumed_at),
    createdAt: toIso(row.created_at),
  });
}

function mapConnection(row: ConnectionRow): MercadoLibreConnection {
  return Object.freeze({
    accountId: row.account_id,
    organizationId: row.organization_id,
    mercadoLibreUserId: Number(row.mercado_libre_user_id),
    siteId: row.site_id,
    nickname: row.nickname,
    status: row.status,
    accessTokenCiphertext: row.access_token_ciphertext,
    refreshTokenCiphertext: row.refresh_token_ciphertext,
    accessExpiresAt: toIso(row.access_expires_at),
    tokenVersion: row.token_version,
    lastSyncedAt: row.last_synced_at === null ? null : toIso(row.last_synced_at),
    lastError: row.last_error,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
