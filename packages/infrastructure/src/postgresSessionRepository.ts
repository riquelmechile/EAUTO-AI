import type { Pool } from "pg";
import type { OperatorSession } from "@eauto/domain";
import type { SessionRepository } from "@eauto/application";

type SessionRow = { payload_json: OperatorSession };

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly pool: Pool) {}

  async save(session: OperatorSession): Promise<void> {
    await this.pool.query(
      `INSERT INTO operator_sessions
        (id, organization_id, actor_id, access_token_hash, refresh_token_hash,
         access_expires_at, refresh_expires_at, revoked_at, payload_json, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET
         access_token_hash = EXCLUDED.access_token_hash,
         refresh_token_hash = EXCLUDED.refresh_token_hash,
         access_expires_at = EXCLUDED.access_expires_at,
         refresh_expires_at = EXCLUDED.refresh_expires_at,
         revoked_at = EXCLUDED.revoked_at,
         payload_json = EXCLUDED.payload_json,
         updated_at = now()`,
      [
        session.id,
        session.actor.organizationId,
        session.actor.id,
        session.accessTokenHash,
        session.refreshTokenHash,
        session.accessExpiresAt,
        session.refreshExpiresAt,
        session.revokedAt,
        JSON.stringify(session),
      ],
    );
  }

  async findByAccessTokenHash(hash: string): Promise<OperatorSession | null> {
    const result = await this.pool.query<SessionRow>(
      `SELECT payload_json FROM operator_sessions
       WHERE access_token_hash = $1
       LIMIT 1`,
      [hash],
    );
    return result.rows[0]?.payload_json ?? null;
  }

  async findByRefreshTokenHash(hash: string): Promise<OperatorSession | null> {
    const result = await this.pool.query<SessionRow>(
      `SELECT payload_json FROM operator_sessions
       WHERE refresh_token_hash = $1
       LIMIT 1`,
      [hash],
    );
    return result.rows[0]?.payload_json ?? null;
  }

  async rotate(input: {
    currentRefreshTokenHash: string;
    replacement: OperatorSession;
  }): Promise<boolean> {
    const session = input.replacement;
    const result = await this.pool.query(
      `UPDATE operator_sessions
       SET access_token_hash = $3,
           refresh_token_hash = $4,
           access_expires_at = $5,
           refresh_expires_at = $6,
           payload_json = $7::jsonb,
           updated_at = now()
       WHERE id = $1
         AND refresh_token_hash = $2
         AND revoked_at IS NULL`,
      [
        session.id,
        input.currentRefreshTokenHash,
        session.accessTokenHash,
        session.refreshTokenHash,
        session.accessExpiresAt,
        session.refreshExpiresAt,
        JSON.stringify(session),
      ],
    );
    return result.rowCount === 1;
  }

  async revoke(input: { sessionId: string; revokedAt: string }): Promise<void> {
    await this.pool.query(
      `UPDATE operator_sessions
       SET revoked_at = $2,
           payload_json = jsonb_set(payload_json, '{revokedAt}', to_jsonb($2::text), true),
           updated_at = now()
       WHERE id = $1`,
      [input.sessionId, input.revokedAt],
    );
  }
}
