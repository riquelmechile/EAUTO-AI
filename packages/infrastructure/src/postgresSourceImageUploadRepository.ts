import type { Pool } from "pg";
import type { SourceImageUpload } from "@eauto/domain";
import type { SourceImageUploadRepository } from "@eauto/application";

export class PostgresSourceImageUploadRepository implements SourceImageUploadRepository {
  constructor(private readonly pool: Pool) {}

  async save(upload: SourceImageUpload): Promise<void> {
    await this.pool.query(
      `INSERT INTO source_image_uploads
        (id, organization_id, account_id, object_key, status, expires_at, payload_json, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         payload_json = EXCLUDED.payload_json,
         updated_at = now()`,
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
  }

  async get(id: string): Promise<SourceImageUpload | null> {
    const result = await this.pool.query<{ payload_json: SourceImageUpload }>(
      "SELECT payload_json FROM source_image_uploads WHERE id = $1",
      [id],
    );
    return result.rows[0]?.payload_json ?? null;
  }
}
