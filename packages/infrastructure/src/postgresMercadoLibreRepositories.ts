import type { Pool, PoolClient } from "pg";
import type {
  MercadoLibreConnectionRepository,
  MercadoLibreCredentialRecord,
  MercadoLibreOAuthStateRecord,
  MercadoLibreOAuthStateRepository,
} from "@eauto/application";
import type { MercadoLibreListingSnapshot } from "@eauto/domain";

type OAuthStateRow = { payload_json: MercadoLibreOAuthStateRecord };
type CredentialRow = { payload_json: MercadoLibreCredentialRecord };
type SnapshotRow = { payload_json: MercadoLibreListingSnapshot };

export class PostgresMercadoLibreOAuthStateRepository
  implements MercadoLibreOAuthStateRepository
{
  constructor(private readonly pool: Pool) {}

  async create(record: MercadoLibreOAuthStateRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO mercadolibre_oauth_states
        (state_hash, organization_id, account_id, expires_at, payload_json)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        record.stateHash,
        record.organizationId,
        record.accountId,
        record.expiresAt,
        JSON.stringify(record),
      ],
    );
  }

  async consume(stateHash: string, now: Date): Promise<MercadoLibreOAuthStateRecord | null> {
    const result = await this.pool.query<OAuthStateRow>(
      `DELETE FROM mercadolibre_oauth_states
       WHERE state_hash = $1 AND expires_at > $2
       RETURNING payload_json`,
      [stateHash, now.toISOString()],
    );
    return result.rows[0]?.payload_json ?? null;
  }
}

export class PostgresMercadoLibreConnectionRepository
  implements MercadoLibreConnectionRepository
{
  constructor(private readonly pool: Pool) {}

  async get(accountId: string): Promise<MercadoLibreCredentialRecord | null> {
    const result = await this.pool.query<CredentialRow>(
      `SELECT payload_json
       FROM mercadolibre_connections
       WHERE account_id = $1
       LIMIT 1`,
      [accountId],
    );
    return result.rows[0]?.payload_json ?? null;
  }

  async save(record: MercadoLibreCredentialRecord): Promise<void> {
    const result = await this.pool.query(
      `INSERT INTO mercadolibre_connections
        (account_id, organization_id, seller_id, site_id, status, expires_at,
         refresh_lease_owner, refresh_lease_until, last_synced_at, payload_json, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now())
       ON CONFLICT (account_id) DO UPDATE SET
         organization_id = EXCLUDED.organization_id,
         site_id = EXCLUDED.site_id,
         status = EXCLUDED.status,
         expires_at = EXCLUDED.expires_at,
         refresh_lease_owner = EXCLUDED.refresh_lease_owner,
         refresh_lease_until = EXCLUDED.refresh_lease_until,
         last_synced_at = EXCLUDED.last_synced_at,
         payload_json = EXCLUDED.payload_json,
         updated_at = now()
       WHERE mercadolibre_connections.seller_id = EXCLUDED.seller_id
         AND mercadolibre_connections.organization_id = EXCLUDED.organization_id`,
      [
        record.connection.accountId,
        record.connection.organizationId,
        record.connection.sellerId,
        record.connection.siteId,
        record.connection.status,
        record.connection.expiresAt,
        record.refreshLeaseOwner ?? null,
        record.refreshLeaseUntil ?? null,
        record.connection.lastSyncedAt ?? null,
        JSON.stringify(record),
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error(
        `MercadoLibre seller or organization binding cannot change for ${record.connection.accountId}.`,
      );
    }
  }

  async acquireRefreshLease(input: {
    accountId: string;
    owner: string;
    now: Date;
    leaseUntil: Date;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE mercadolibre_connections
       SET refresh_lease_owner = $2,
           refresh_lease_until = $4,
           payload_json = jsonb_set(
             jsonb_set(payload_json, '{refreshLeaseOwner}', to_jsonb($2::text), true),
             '{refreshLeaseUntil}', to_jsonb($4::text), true
           ),
           updated_at = now()
       WHERE account_id = $1
         AND status = 'active'
         AND (refresh_lease_until IS NULL OR refresh_lease_until <= $3)`,
      [input.accountId, input.owner, input.now.toISOString(), input.leaseUntil.toISOString()],
    );
    return result.rowCount === 1;
  }

  async releaseRefreshLease(accountId: string, owner: string): Promise<void> {
    await this.pool.query(
      `UPDATE mercadolibre_connections
       SET refresh_lease_owner = NULL,
           refresh_lease_until = NULL,
           payload_json = (payload_json - 'refreshLeaseOwner' - 'refreshLeaseUntil'),
           updated_at = now()
       WHERE account_id = $1 AND refresh_lease_owner = $2`,
      [accountId, owner],
    );
  }

  async markReauthorizationRequired(accountId: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE mercadolibre_connections
       SET status = 'reauthorization-required',
           refresh_lease_owner = NULL,
           refresh_lease_until = NULL,
           payload_json = jsonb_set(
             jsonb_set(payload_json - 'refreshLeaseOwner' - 'refreshLeaseUntil',
               '{connection,status}', '"reauthorization-required"'::jsonb, true),
             '{connection,updatedAt}', to_jsonb($2::text), true
           ),
           updated_at = now()
       WHERE account_id = $1`,
      [accountId, now.toISOString()],
    );
  }

  async replaceListingSnapshots(
    accountId: string,
    snapshots: readonly MercadoLibreListingSnapshot[],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM mercadolibre_listing_snapshots WHERE account_id = $1`, [
        accountId,
      ]);
      for (const snapshot of snapshots) {
        await insertSnapshot(client, snapshot);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listListingSnapshots(
    accountId: string,
  ): Promise<readonly MercadoLibreListingSnapshot[]> {
    const result = await this.pool.query<SnapshotRow>(
      `SELECT payload_json
       FROM mercadolibre_listing_snapshots
       WHERE account_id = $1
       ORDER BY item_id ASC`,
      [accountId],
    );
    return result.rows.map((row) => row.payload_json);
  }
}

async function insertSnapshot(
  client: PoolClient,
  snapshot: MercadoLibreListingSnapshot,
): Promise<void> {
  await client.query(
    `INSERT INTO mercadolibre_listing_snapshots
      (account_id, organization_id, seller_id, item_id, observed_at, payload_json)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      snapshot.accountId,
      snapshot.organizationId,
      snapshot.sellerId,
      snapshot.itemId,
      snapshot.observedAt,
      JSON.stringify(snapshot),
    ],
  );
}
