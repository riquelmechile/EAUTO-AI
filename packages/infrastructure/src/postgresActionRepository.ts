import type { Pool } from "pg";
import type { Approval, BusinessAction } from "@eauto/domain";
import type { ActionRepository } from "@eauto/application";

export class PostgresActionRepository implements ActionRepository {
  constructor(private readonly pool: Pool) {}

  async save(action: BusinessAction): Promise<void> {
    await this.pool.query(
      `INSERT INTO business_actions (id, account_id, status, payload_json, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, payload_json = EXCLUDED.payload_json, updated_at = now()`,
      [action.id, action.accountId, action.status, JSON.stringify(action)],
    );
  }

  async get(id: string): Promise<BusinessAction | null> {
    const result = await this.pool.query<{ payload_json: BusinessAction }>(
      "SELECT payload_json FROM business_actions WHERE id = $1",
      [id],
    );
    return result.rows[0]?.payload_json ?? null;
  }

  async listPending(accountId?: string): Promise<readonly BusinessAction[]> {
    const result = accountId
      ? await this.pool.query<{ payload_json: BusinessAction }>(
          `SELECT payload_json FROM business_actions
           WHERE account_id = $1 AND status = ANY($2::text[]) ORDER BY updated_at ASC`,
          [accountId, ["proposed", "reviewed", "approved"]],
        )
      : await this.pool.query<{ payload_json: BusinessAction }>(
          `SELECT payload_json FROM business_actions
           WHERE status = ANY($1::text[]) ORDER BY updated_at ASC`,
          [["proposed", "reviewed", "approved"]],
        );
    return result.rows.map((row) => row.payload_json);
  }

  async saveApproval(approval: Approval): Promise<void> {
    await this.pool.query(
      `INSERT INTO approvals (id, action_id, action_hash, approved_by, approved_at, expires_at, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        approval.id,
        approval.actionId,
        approval.actionHash,
        approval.approvedBy,
        approval.approvedAt,
        approval.expiresAt,
        JSON.stringify(approval),
      ],
    );
  }

  async getApproval(actionId: string): Promise<Approval | null> {
    const result = await this.pool.query<{ payload_json: Approval }>(
      "SELECT payload_json FROM approvals WHERE action_id = $1 ORDER BY approved_at DESC LIMIT 1",
      [actionId],
    );
    return result.rows[0]?.payload_json ?? null;
  }
}
