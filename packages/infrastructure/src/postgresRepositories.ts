import type { Pool } from "pg";
import type { CommerceAccount, ContentAsset } from "@eauto/domain";
import type { VerifiableReceipt } from "@eauto/agent-kernel";
import type {
  AccountRepository,
  ContentAssetRepository,
  ReceiptRepository,
} from "@eauto/application";

export class PostgresAccountRepository implements AccountRepository {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<readonly CommerceAccount[]> {
    const result = await this.pool.query<{
      id: string;
      organization_id: string;
      name: string;
      channel: CommerceAccount["channel"];
      market: string;
      minimum_margin_bps: number;
      autonomy_level: CommerceAccount["autonomyLevel"];
    }>(`SELECT id, organization_id, name, channel, market, minimum_margin_bps, autonomy_level
        FROM commerce_accounts ORDER BY name ASC`);
    return result.rows.map(toAccount);
  }

  async get(id: string): Promise<CommerceAccount | null> {
    const result = await this.pool.query<{
      id: string;
      organization_id: string;
      name: string;
      channel: CommerceAccount["channel"];
      market: string;
      minimum_margin_bps: number;
      autonomy_level: CommerceAccount["autonomyLevel"];
    }>(
      `SELECT id, organization_id, name, channel, market, minimum_margin_bps, autonomy_level
        FROM commerce_accounts WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? toAccount(row) : null;
  }
}

function toAccount(row: {
  id: string;
  organization_id: string;
  name: string;
  channel: CommerceAccount["channel"];
  market: string;
  minimum_margin_bps: number;
  autonomy_level: CommerceAccount["autonomyLevel"];
}): CommerceAccount {
  return Object.freeze({
    id: row.id as CommerceAccount["id"],
    organizationId: row.organization_id as CommerceAccount["organizationId"],
    name: row.name,
    channel: row.channel,
    market: row.market,
    minimumMarginBps: row.minimum_margin_bps,
    autonomyLevel: row.autonomy_level,
  });
}

export class PostgresReceiptRepository implements ReceiptRepository {
  constructor(private readonly pool: Pool) {}

  async append(receipt: VerifiableReceipt): Promise<void> {
    await this.pool.query(
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

  async listForAction(actionId: string): Promise<readonly VerifiableReceipt[]> {
    const result = await this.pool.query<{ payload_json: VerifiableReceipt }>(
      `SELECT payload_json FROM verifiable_receipts WHERE action_id = $1 ORDER BY recorded_at ASC, id ASC`,
      [actionId],
    );
    return result.rows.map((row) => row.payload_json);
  }
}

export class PostgresContentAssetRepository implements ContentAssetRepository {
  constructor(private readonly pool: Pool) {}

  async save(asset: ContentAsset): Promise<void> {
    await this.pool.query(
      `INSERT INTO content_assets (
        id, account_id, product_id, kind, uri, content_hash, provider, model,
        prompt_version, moderation_status, created_at, metadata_json
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'{}'::jsonb)`,
      [
        asset.id,
        asset.accountId,
        asset.productId,
        asset.kind,
        asset.uri,
        asset.contentHash,
        asset.provider,
        asset.model,
        asset.promptVersion,
        asset.moderationStatus,
        asset.createdAt,
      ],
    );
  }

  async listForProduct(productId: string): Promise<readonly ContentAsset[]> {
    const result = await this.pool.query<{
      id: string;
      account_id: string;
      product_id: string;
      kind: ContentAsset["kind"];
      uri: string;
      content_hash: string;
      provider: string;
      model: string;
      prompt_version: string;
      moderation_status: ContentAsset["moderationStatus"];
      created_at: Date | string;
    }>(
      `SELECT id, account_id, product_id, kind, uri, content_hash, provider, model,
        prompt_version, moderation_status, created_at
        FROM content_assets WHERE product_id = $1 ORDER BY created_at ASC`,
      [productId],
    );
    return result.rows.map((row) =>
      Object.freeze({
        id: row.id,
        accountId: row.account_id,
        productId: row.product_id,
        kind: row.kind,
        uri: row.uri,
        contentHash: row.content_hash,
        provider: row.provider,
        model: row.model,
        promptVersion: row.prompt_version,
        moderationStatus: row.moderation_status,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      }),
    );
  }
}
