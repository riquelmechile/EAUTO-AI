import type { Pool, PoolClient } from "pg";
import type { ActionStatus, Approval, BusinessAction } from "@eauto/domain";
import { createReceipt, type VerifiableReceipt } from "@eauto/agent-kernel";
import type { ActionRepository, LifecycleReceiptDraft, OutboxEventDraft } from "@eauto/application";

const expectedPreviousStatuses: Readonly<Record<ActionStatus, readonly ActionStatus[]>> =
  Object.freeze({
    draft: [],
    proposed: ["draft"],
    reviewed: ["proposed"],
    approved: ["reviewed"],
    executing: ["approved"],
    executed: ["executing"],
    verified: ["executed"],
    failed: ["executing", "executed"],
    uncertain: ["executing", "executed"],
    rejected: ["proposed", "reviewed"],
    expired: ["proposed", "reviewed", "approved"],
  });

export class PostgresActionRepository implements ActionRepository {
  constructor(private readonly pool: Pool) {}

  async save(
    action: BusinessAction,
    event?: OutboxEventDraft,
    receipt?: LifecycleReceiptDraft,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockAction(client, action.id);
      await this.persistAction(client, action);
      if (receipt) await this.persistReceipt(client, receipt);
      if (event) await this.persistEvent(client, event);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async get(id: string): Promise<BusinessAction | null> {
    const result = await this.pool.query<{ payload_json: BusinessAction }>(
      "SELECT payload_json FROM business_actions WHERE id = $1",
      [id],
    );
    return result.rows[0]?.payload_json ?? null;
  }

  async listPending(accountId: string): Promise<readonly BusinessAction[]> {
    const result = await this.pool.query<{ payload_json: BusinessAction }>(
      `SELECT payload_json FROM business_actions
       WHERE account_id = $1 AND status = ANY($2::text[]) ORDER BY updated_at ASC`,
      [accountId, ["proposed", "reviewed", "approved", "uncertain"]],
    );
    return result.rows.map((row) => row.payload_json);
  }

  async saveApproval(
    approval: Approval,
    approvedAction: BusinessAction,
    event?: OutboxEventDraft,
    receipt?: LifecycleReceiptDraft,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockAction(client, approvedAction.id);
      await this.persistAction(client, approvedAction);
      await client.query(
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
      if (receipt) await this.persistReceipt(client, receipt);
      if (event) await this.persistEvent(client, event);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getApproval(actionId: string): Promise<Approval | null> {
    const result = await this.pool.query<{ payload_json: Approval }>(
      "SELECT payload_json FROM approvals WHERE action_id = $1 LIMIT 1",
      [actionId],
    );
    return result.rows[0]?.payload_json ?? null;
  }

  private async lockAction(client: PoolClient, actionId: string): Promise<void> {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [actionId]);
  }

  private async persistReceipt(client: PoolClient, draft: LifecycleReceiptDraft): Promise<void> {
    const previous = await client.query<{ chain_hash: string }>(
      `SELECT chain_hash FROM verifiable_receipts
       WHERE action_id = $1 ORDER BY recorded_at DESC, id DESC LIMIT 1`,
      [draft.actionId],
    );
    const receipt: VerifiableReceipt = createReceipt({
      ...draft,
      previousReceiptHash: previous.rows[0]?.chain_hash ?? null,
    });
    await client.query(
      `INSERT INTO verifiable_receipts (
        id, receipt_type, account_id, action_id, content_hash, policy_hash, evidence_hash,
        previous_receipt_hash, payload_hash, chain_hash, recorded_at, payload_json
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
      [
        receipt.id,
        receipt.type,
        receipt.accountId,
        receipt.actionId,
        receipt.contentHash,
        receipt.policyHash,
        receipt.evidenceHash,
        receipt.previousReceiptHash,
        receipt.payloadHash,
        receipt.chainHash,
        receipt.recordedAt,
        JSON.stringify(receipt),
      ],
    );
  }

  private async persistAction(client: PoolClient, action: BusinessAction): Promise<void> {
    if (action.status === "proposed") {
      const inserted = await client.query(
        `INSERT INTO business_actions (id, account_id, status, payload_json, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, now())
         ON CONFLICT (id) DO NOTHING`,
        [action.id, action.accountId, action.status, JSON.stringify(action)],
      );
      if (inserted.rowCount !== 1) {
        throw new Error(`Action ${action.id} already exists.`);
      }
      return;
    }

    const expected = expectedPreviousStatuses[action.status];
    if (expected.length === 0) {
      throw new Error(`Action status ${action.status} cannot be persisted as a transition.`);
    }
    const updated = await client.query(
      `UPDATE business_actions
       SET status = $3, payload_json = $4::jsonb, updated_at = now()
       WHERE id = $1 AND account_id = $2 AND status = ANY($5::text[])`,
      [action.id, action.accountId, action.status, JSON.stringify(action), expected],
    );
    if (updated.rowCount !== 1) {
      throw new Error(`Action ${action.id} transition conflict.`);
    }
  }

  private async persistEvent(client: PoolClient, event: OutboxEventDraft): Promise<void> {
    const result = await client.query(
      `INSERT INTO transactional_outbox
        (id, idempotency_key, aggregate_type, aggregate_id, account_id, event_type, payload_json, status, available_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'pending', $8)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        event.id,
        event.idempotencyKey,
        event.aggregateType,
        event.aggregateId,
        event.accountId ?? null,
        event.eventType,
        JSON.stringify(event.payload),
        event.availableAt,
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error(`Outbox event ${event.idempotencyKey} already exists.`);
    }
  }
}
