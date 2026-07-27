import type { Pool } from "pg";
import type { SourceImageUpload } from "@eauto/domain";
import type { SourceImageUploadRepository } from "@eauto/application";

export class PostgresSourceImageUploadRepository implements SourceImageUploadRepository {
  constructor(private readonly pool: Pool) {}

  async save(upload: SourceImageUpload): Promise<void> {
    if (upload.status === "requested") {
      const inserted = await this.pool.query(
        `INSERT INTO source_image_uploads
          (id, organization_id, account_id, object_key, status, expires_at, payload_json, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
         ON CONFLICT (id) DO NOTHING`,
        [
          upload.id,
          upload.organizationId,
          upload.accountId,
          upload.objectKey,
          upload.status,
          upload.expiresAt,
          JSON.stringify(upload),
        ],
      );
      if (inserted.rowCount === 1) return;
      const existing = await this.get({
        id: upload.id,
        organizationId: upload.organizationId,
        accountId: upload.accountId,
      });
      if (!existing || JSON.stringify(existing) !== JSON.stringify(upload)) {
        throw new Error(`Upload ${upload.id} already exists with different ownership or content.`);
      }
      return;
    }

    const updated = await this.pool.query(
      `UPDATE source_image_uploads
       SET status = $5, payload_json = $6::jsonb, updated_at = now()
       WHERE id = $1 AND organization_id = $2 AND account_id = $3
         AND object_key = $4 AND status = 'requested'`,
      [
        upload.id,
        upload.organizationId,
        upload.accountId,
        upload.objectKey,
        upload.status,
        JSON.stringify(upload),
      ],
    );
    if (updated.rowCount !== 1) throw new Error(`Upload ${upload.id} transition conflict.`);
  }

  async get(input: {
    id: string;
    organizationId: string;
    accountId: string;
  }): Promise<SourceImageUpload | null> {
    const result = await this.pool.query<{ payload_json: SourceImageUpload }>(
      `SELECT payload_json FROM source_image_uploads
       WHERE id = $1 AND organization_id = $2 AND account_id = $3`,
      [input.id, input.organizationId, input.accountId],
    );
    return result.rows[0]?.payload_json ?? null;
  }
}
