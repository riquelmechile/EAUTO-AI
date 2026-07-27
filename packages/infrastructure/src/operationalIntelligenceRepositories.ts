import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  AgentWorkOrder,
  ConsultativeMemoryRecord,
  EvidenceDocument,
  EvidenceSubject,
  OperationalEvidencePack,
  ShadowProposalRecord,
  WorkOrderStatus,
} from "@eauto/domain";
import type {
  OperationalEvidenceReader,
  OperationalIntelligenceRepository,
  OperationalScope,
} from "@eauto/application";

function scopedKey(input: OperationalScope & { value: string }): string {
  return `${input.organizationId}\u0000${input.accountId}\u0000${input.value}`;
}

export class InMemoryOperationalEvidenceReader implements OperationalEvidenceReader {
  constructor(
    private readonly documents: Readonly<Record<string, readonly EvidenceDocument[]>> = {},
  ) {}

  read(input: {
    organizationId: string;
    accountId: string;
    subject: EvidenceSubject;
    asOf: string;
    maximumAgeMs: number;
  }): Promise<
    Readonly<{ documents: readonly EvidenceDocument[]; missingInputs: readonly string[] }>
  > {
    const key = `${input.organizationId}:${input.accountId}:${input.subject}`;
    const admitted = (this.documents[key] ?? []).filter(
      (document) =>
        Date.parse(document.expiresAt) > Date.parse(input.asOf) &&
        document.reference.freshness === "fresh",
    );
    return Promise.resolve({
      documents: Object.freeze(admitted),
      missingInputs:
        admitted.length === 0 ? Object.freeze([`${input.subject}-evidence`]) : Object.freeze([]),
    });
  }
}

export class InMemoryOperationalIntelligenceRepository implements OperationalIntelligenceRepository {
  private readonly packs = new Map<string, OperationalEvidencePack>();
  private readonly memory = new Map<string, ConsultativeMemoryRecord>();
  private readonly orders = new Map<string, AgentWorkOrder>();
  private readonly idempotency = new Map<string, string>();
  private readonly proposals = new Map<string, ShadowProposalRecord>();

  saveEvidencePack(pack: OperationalEvidencePack): Promise<void> {
    this.packs.set(pack.id, pack);
    return Promise.resolve();
  }

  getEvidencePack(
    input: OperationalScope & { id: string },
  ): Promise<OperationalEvidencePack | null> {
    const pack = this.packs.get(input.id);
    if (
      !pack ||
      pack.organizationId !== input.organizationId ||
      pack.accountId !== input.accountId
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve(pack);
  }

  listEvidencePacks(
    input: OperationalScope & { limit: number },
  ): Promise<readonly OperationalEvidencePack[]> {
    return Promise.resolve(
      sortDescending(
        [...this.packs.values()].filter(
          (pack) =>
            pack.organizationId === input.organizationId && pack.accountId === input.accountId,
        ),
        "generatedAt",
      ).slice(0, input.limit),
    );
  }

  saveMemory(record: ConsultativeMemoryRecord): Promise<void> {
    const existing = this.memory.get(record.id);
    if (existing && existing.contentHash !== record.contentHash) {
      throw new Error(`Memory ${record.id} is immutable.`);
    }
    this.memory.set(record.id, record);
    return Promise.resolve();
  }

  listMemory(
    input: OperationalScope & { limit: number },
  ): Promise<readonly ConsultativeMemoryRecord[]> {
    return Promise.resolve(
      sortDescending(
        [...this.memory.values()].filter(
          (record) =>
            record.organizationId === input.organizationId &&
            (record.accountId === null || record.accountId === input.accountId),
        ),
        "createdAt",
      ).slice(0, input.limit),
    );
  }

  enqueueWorkOrder(order: AgentWorkOrder): Promise<AgentWorkOrder> {
    const key = scopedKey({
      organizationId: order.organizationId,
      accountId: order.accountId,
      value: order.idempotencyKey,
    });
    const existingId = this.idempotency.get(key);
    if (existingId) return Promise.resolve(this.orders.get(existingId) ?? order);
    this.orders.set(order.id, order);
    this.idempotency.set(key, order.id);
    return Promise.resolve(order);
  }

  getWorkOrder(input: OperationalScope & { id: string }): Promise<AgentWorkOrder | null> {
    const order = this.orders.get(input.id);
    if (
      !order ||
      order.organizationId !== input.organizationId ||
      order.accountId !== input.accountId
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve(order);
  }

  listWorkOrders(input: OperationalScope & { limit: number }): Promise<readonly AgentWorkOrder[]> {
    return Promise.resolve(
      sortDescending(
        [...this.orders.values()].filter(
          (order) =>
            order.organizationId === input.organizationId && order.accountId === input.accountId,
        ),
        "createdAt",
      ).slice(0, input.limit),
    );
  }

  leaseWorkOrders(input: {
    owner: string;
    now: Date;
    leaseUntil: Date;
    limit: number;
  }): Promise<readonly AgentWorkOrder[]> {
    const nowMs = input.now.getTime();
    const candidates = [...this.orders.values()]
      .filter(
        (order) =>
          (["queued", "failed"] as readonly WorkOrderStatus[]).includes(order.status) &&
          Date.parse(order.availableAt) <= nowMs &&
          (order.leaseUntil === null || Date.parse(order.leaseUntil) <= nowMs),
      )
      .sort((left, right) => right.expectedUtility - left.expectedUtility)
      .slice(0, input.limit);
    const leased = candidates.map((order) => {
      const next = Object.freeze({
        ...order,
        status: "processing" as const,
        attempts: order.attempts + 1,
        leaseOwner: input.owner,
        leaseUntil: input.leaseUntil.toISOString(),
        updatedAt: input.now.toISOString(),
      });
      this.orders.set(next.id, next);
      return next;
    });
    return Promise.resolve(Object.freeze(leased));
  }

  updateWorkOrder(order: AgentWorkOrder): Promise<void> {
    const existing = this.orders.get(order.id);
    if (
      !existing ||
      existing.organizationId !== order.organizationId ||
      existing.accountId !== order.accountId
    ) {
      throw new Error(`Work order ${order.id} not found.`);
    }
    this.orders.set(order.id, order);
    return Promise.resolve();
  }

  saveProposal(proposal: ShadowProposalRecord): Promise<void> {
    const existing = this.proposals.get(proposal.id);
    if (existing && existing.contentHash !== proposal.contentHash) {
      throw new Error(`Proposal ${proposal.id} is immutable.`);
    }
    this.proposals.set(proposal.id, proposal);
    return Promise.resolve();
  }

  listProposals(
    input: OperationalScope & { limit: number },
  ): Promise<readonly ShadowProposalRecord[]> {
    return Promise.resolve(
      sortDescending(
        [...this.proposals.values()].filter(
          (proposal) =>
            proposal.organizationId === input.organizationId &&
            proposal.accountId === input.accountId,
        ),
        "createdAt",
      ).slice(0, input.limit),
    );
  }

  decideProposal(
    input: OperationalScope & {
      id: string;
      status: "approved" | "rejected" | "superseded";
      decidedAt: string;
      decidedBy: string;
    },
  ): Promise<ShadowProposalRecord | null> {
    const current = this.proposals.get(input.id);
    if (
      !current ||
      current.organizationId !== input.organizationId ||
      current.accountId !== input.accountId ||
      current.status !== "pending-approval"
    ) {
      return Promise.resolve(null);
    }
    const decided = Object.freeze({
      ...current,
      status: input.status,
      decidedAt: input.decidedAt,
      decidedBy: input.decidedBy,
    });
    this.proposals.set(current.id, decided);
    return Promise.resolve(decided);
  }
}

export class PostgresOperationalEvidenceReader implements OperationalEvidenceReader {
  constructor(private readonly pool: Pool) {}

  async read(input: {
    organizationId: string;
    accountId: string;
    subject: EvidenceSubject;
    asOf: string;
    maximumAgeMs: number;
  }): Promise<
    Readonly<{ documents: readonly EvidenceDocument[]; missingInputs: readonly string[] }>
  > {
    const minimumObservedAt = new Date(Date.parse(input.asOf) - input.maximumAgeMs).toISOString();
    const rows = await readSubjectRows(
      this.pool,
      input.subject,
      input.organizationId,
      input.accountId,
      minimumObservedAt,
    );
    const expiresAt = new Date(Date.parse(input.asOf) + input.maximumAgeMs).toISOString();
    const documents = rows.map((row) => {
      const payloadHash = hashJson(row.payload_json);
      return Object.freeze({
        reference: Object.freeze({
          id: `${input.subject}:${row.source_id}`,
          source: row.source,
          sourceRecordId: row.source_id,
          observedAt: row.observed_at,
          freshness: "fresh" as const,
          confidence: "high" as const,
          contentHash: payloadHash,
        }),
        subject: input.subject,
        kind: evidenceKindFor(row.source),
        authority: "authoritative" as const,
        expiresAt,
        payload: row.payload_json,
      });
    });
    return Object.freeze({
      documents: Object.freeze(documents),
      missingInputs:
        documents.length === 0 ? Object.freeze([`${input.subject}-read-model`]) : Object.freeze([]),
    });
  }
}

export class PostgresOperationalIntelligenceRepository implements OperationalIntelligenceRepository {
  constructor(private readonly pool: Pool) {}

  async saveEvidencePack(pack: OperationalEvidencePack): Promise<void> {
    await this.pool.query(
      `INSERT INTO operational_evidence_packs
       (id, organization_id, account_id, subject, purpose, complete, expires_at, content_hash, payload_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [
        pack.id,
        pack.organizationId,
        pack.accountId,
        pack.subject,
        pack.purpose,
        pack.complete,
        pack.expiresAt,
        pack.contentHash,
        JSON.stringify(pack),
      ],
    );
  }

  async getEvidencePack(
    input: OperationalScope & { id: string },
  ): Promise<OperationalEvidencePack | null> {
    const result = await this.pool.query<{ payload_json: OperationalEvidencePack }>(
      `SELECT payload_json FROM operational_evidence_packs
       WHERE id = $1 AND organization_id = $2 AND account_id = $3`,
      [input.id, input.organizationId, input.accountId],
    );
    return result.rows[0]?.payload_json ?? null;
  }

  async listEvidencePacks(input: OperationalScope & { limit: number }) {
    const result = await this.pool.query<{ payload_json: OperationalEvidencePack }>(
      `SELECT payload_json FROM operational_evidence_packs
       WHERE organization_id = $1 AND account_id = $2
       ORDER BY created_at DESC LIMIT $3`,
      [input.organizationId, input.accountId, input.limit],
    );
    return result.rows.map((row) => row.payload_json);
  }

  async saveMemory(record: ConsultativeMemoryRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO consultative_memory
       (id, organization_id, account_id, kind, verified_outcome, expires_at, content_hash, payload_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [
        record.id,
        record.organizationId,
        record.accountId,
        record.kind,
        record.verifiedOutcome,
        record.expiresAt,
        record.contentHash,
        JSON.stringify(record),
      ],
    );
  }

  async listMemory(input: OperationalScope & { limit: number }) {
    const result = await this.pool.query<{ payload_json: ConsultativeMemoryRecord }>(
      `SELECT payload_json FROM consultative_memory
       WHERE organization_id = $1 AND (account_id IS NULL OR account_id = $2)
       ORDER BY created_at DESC LIMIT $3`,
      [input.organizationId, input.accountId, input.limit],
    );
    return result.rows.map((row) => row.payload_json);
  }

  async enqueueWorkOrder(order: AgentWorkOrder): Promise<AgentWorkOrder> {
    const result = await this.pool.query<{ payload_json: AgentWorkOrder }>(
      `INSERT INTO agent_work_orders
       (id, idempotency_key, organization_id, account_id, agent_id, status, expected_utility,
        available_at, lease_owner, lease_until, attempts, maximum_attempts, payload_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
       ON CONFLICT (organization_id, account_id, idempotency_key)
       DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
       RETURNING payload_json`,
      [
        order.id,
        order.idempotencyKey,
        order.organizationId,
        order.accountId,
        order.agentId,
        order.status,
        order.expectedUtility,
        order.availableAt,
        order.leaseOwner,
        order.leaseUntil,
        order.attempts,
        order.maximumAttempts,
        JSON.stringify(order),
      ],
    );
    const persisted = result.rows[0]?.payload_json;
    if (!persisted) throw new Error("Work order enqueue returned no record.");
    return persisted;
  }

  async getWorkOrder(input: OperationalScope & { id: string }): Promise<AgentWorkOrder | null> {
    const result = await this.pool.query<{ payload_json: AgentWorkOrder }>(
      `SELECT payload_json FROM agent_work_orders
       WHERE id = $1 AND organization_id = $2 AND account_id = $3`,
      [input.id, input.organizationId, input.accountId],
    );
    return result.rows[0]?.payload_json ?? null;
  }

  async listWorkOrders(input: OperationalScope & { limit: number }) {
    const result = await this.pool.query<{ payload_json: AgentWorkOrder }>(
      `SELECT payload_json FROM agent_work_orders
       WHERE organization_id = $1 AND account_id = $2
       ORDER BY created_at DESC LIMIT $3`,
      [input.organizationId, input.accountId, input.limit],
    );
    return result.rows.map((row) => row.payload_json);
  }

  async leaseWorkOrders(input: {
    owner: string;
    now: Date;
    leaseUntil: Date;
    limit: number;
  }): Promise<readonly AgentWorkOrder[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ payload_json: AgentWorkOrder }>(
        `SELECT payload_json FROM agent_work_orders
         WHERE status IN ('queued','failed')
           AND available_at <= $1
           AND (lease_until IS NULL OR lease_until <= $1)
         ORDER BY expected_utility DESC, created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $2`,
        [input.now.toISOString(), input.limit],
      );
      const leased: AgentWorkOrder[] = [];
      for (const row of result.rows) {
        const order = Object.freeze({
          ...row.payload_json,
          status: "processing" as const,
          attempts: row.payload_json.attempts + 1,
          leaseOwner: input.owner,
          leaseUntil: input.leaseUntil.toISOString(),
          updatedAt: input.now.toISOString(),
        });
        await updateOrder(client, order);
        leased.push(order);
      }
      await client.query("COMMIT");
      return Object.freeze(leased);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateWorkOrder(order: AgentWorkOrder): Promise<void> {
    await updateOrder(this.pool, order);
  }

  async saveProposal(proposal: ShadowProposalRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO shadow_proposals
       (id, organization_id, account_id, work_order_id, session_id, llm_run_id, agent_id,
        status, risk, content_hash, payload_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
      [
        proposal.id,
        proposal.organizationId,
        proposal.accountId,
        proposal.workOrderId,
        proposal.sessionId,
        proposal.llmRunId,
        proposal.agentId,
        proposal.status,
        proposal.risk,
        proposal.contentHash,
        JSON.stringify(proposal),
      ],
    );
  }

  async listProposals(input: OperationalScope & { limit: number }) {
    const result = await this.pool.query<{ payload_json: ShadowProposalRecord }>(
      `SELECT payload_json FROM shadow_proposals
       WHERE organization_id = $1 AND account_id = $2
       ORDER BY created_at DESC LIMIT $3`,
      [input.organizationId, input.accountId, input.limit],
    );
    return result.rows.map((row) => row.payload_json);
  }

  async decideProposal(
    input: OperationalScope & {
      id: string;
      status: "approved" | "rejected" | "superseded";
      decidedAt: string;
      decidedBy: string;
    },
  ): Promise<ShadowProposalRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ payload_json: ShadowProposalRecord }>(
        `SELECT payload_json FROM shadow_proposals
         WHERE id = $1 AND organization_id = $2 AND account_id = $3 FOR UPDATE`,
        [input.id, input.organizationId, input.accountId],
      );
      const proposal = current.rows[0]?.payload_json;
      if (!proposal || proposal.status !== "pending-approval") {
        await client.query("ROLLBACK");
        return null;
      }
      const decided = Object.freeze({
        ...proposal,
        status: input.status,
        decidedAt: input.decidedAt,
        decidedBy: input.decidedBy,
      });
      await client.query(
        `UPDATE shadow_proposals
         SET status = $2, decided_at = $3, decided_by = $4, payload_json = $5::jsonb
         WHERE id = $1 AND organization_id = $6 AND account_id = $7`,
        [
          input.id,
          input.status,
          input.decidedAt,
          input.decidedBy,
          JSON.stringify(decided),
          input.organizationId,
          input.accountId,
        ],
      );
      await client.query("COMMIT");
      return decided;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

type EvidenceRow = Readonly<{
  source: string;
  source_id: string;
  observed_at: string;
  payload_json: unknown;
}>;

async function readSubjectRows(
  pool: Pool,
  subject: EvidenceSubject,
  organizationId: string,
  accountId: string,
  minimumObservedAt: string,
): Promise<readonly EvidenceRow[]> {
  const queryBySubject: Partial<Record<EvidenceSubject, string>> = {
    catalog: `SELECT 'mercadolibre-listing' AS source, item_id AS source_id,
              observed_at::text, payload_json
              FROM mercadolibre_listing_snapshots
              WHERE organization_id = $1 AND account_id = $2 AND observed_at >= $3
              ORDER BY observed_at DESC LIMIT 500`,
    customer: `SELECT source, source_id, observed_at::text, payload_json FROM (
                 SELECT 'mercadolibre-claim' AS source, claim_id AS source_id,
                        observed_at, payload_json
                 FROM mercadolibre_claim_snapshots
                 WHERE organization_id = $1 AND account_id = $2 AND observed_at >= $3
                 UNION ALL
                 SELECT 'mercadolibre-question' AS source, question_id AS source_id,
                        observed_at, payload_json
                 FROM mercadolibre_question_snapshots
                 WHERE organization_id = $1 AND account_id = $2 AND observed_at >= $3
               ) evidence ORDER BY observed_at DESC LIMIT 500`,
    commercial: `SELECT 'mercadolibre-order' AS source, order_id AS source_id,
                  observed_at::text, payload_json
                  FROM mercadolibre_order_snapshots
                  WHERE organization_id = $1 AND account_id = $2 AND observed_at >= $3
                  ORDER BY observed_at DESC LIMIT 500`,
    reputation: `SELECT 'mercadolibre-reputation' AS source, seller_id AS source_id,
                  observed_at::text, payload_json
                  FROM mercadolibre_reputation_snapshots
                  WHERE organization_id = $1 AND account_id = $2 AND observed_at >= $3
                  ORDER BY observed_at DESC LIMIT 1`,
    content: `SELECT 'content-asset' AS source, ca.id AS source_id,
              ca.created_at::text AS observed_at, ca.metadata_json AS payload_json
              FROM content_assets ca
              JOIN commerce_accounts account ON account.id = ca.account_id
              WHERE account.organization_id = $1 AND ca.account_id = $2 AND ca.created_at >= $3
              ORDER BY ca.created_at DESC LIMIT 500`,
  };
  const sql = queryBySubject[subject];
  if (!sql) return [];
  const result = await pool.query<EvidenceRow>(sql, [organizationId, accountId, minimumObservedAt]);
  return result.rows;
}

async function updateOrder(client: Pick<Pool, "query"> | PoolClient, order: AgentWorkOrder) {
  await client.query(
    `UPDATE agent_work_orders
     SET status = $2, expected_utility = $3, available_at = $4,
         lease_owner = $5, lease_until = $6, attempts = $7,
         payload_json = $8::jsonb, updated_at = now()
     WHERE id = $1 AND organization_id = $9 AND account_id = $10`,
    [
      order.id,
      order.status,
      order.expectedUtility,
      order.availableAt,
      order.leaseOwner,
      order.leaseUntil,
      order.attempts,
      JSON.stringify(order),
      order.organizationId,
      order.accountId,
    ],
  );
}

function evidenceKindFor(source: string): string {
  const kinds: Readonly<Record<string, string>> = Object.freeze({
    "mercadolibre-listing": "listing-snapshot",
    "mercadolibre-claim": "claim-snapshot",
    "mercadolibre-question": "question-snapshot",
    "mercadolibre-order": "order-snapshot",
    "mercadolibre-reputation": "reputation-snapshot",
    "content-asset": "content-asset",
  });
  return kinds[source] ?? "operational-snapshot";
}

function sortDescending<T extends Record<K, string>, K extends keyof T>(values: T[], key: K): T[] {
  return values.sort((left, right) => right[key].localeCompare(left[key]));
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}
