import type { Pool } from "pg";
import type { LlmRunRecord } from "@eauto/domain";
import type { LlmRunRepository } from "@eauto/application";

export class InMemoryLlmRunRepository implements LlmRunRepository {
  private readonly records = new Map<string, LlmRunRecord>();

  create(record: LlmRunRecord): Promise<void> {
    if (this.records.has(record.id)) throw new Error(`LLM run ${record.id} already exists.`);
    this.records.set(record.id, record);
    return Promise.resolve();
  }

  update(record: LlmRunRecord): Promise<void> {
    if (!this.records.has(record.id)) throw new Error(`LLM run ${record.id} not found.`);
    this.records.set(record.id, record);
    return Promise.resolve();
  }

  get(id: string): Promise<LlmRunRecord | null> {
    return Promise.resolve(this.records.get(id) ?? null);
  }

  list(input: {
    organizationId: string;
    accountId: string;
    limit: number;
  }): Promise<readonly LlmRunRecord[]> {
    return Promise.resolve(
      Object.freeze(
        [...this.records.values()]
          .filter(
            (record) =>
              record.organizationId === input.organizationId &&
              record.accountId === input.accountId,
          )
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .slice(0, input.limit),
      ),
    );
  }

  totalActualCostMicrosUsd(input: {
    organizationId: string;
    accountId: string;
    periodStart: string;
    periodEnd: string;
  }): Promise<number> {
    return Promise.resolve(
      [...this.records.values()]
        .filter(
          (record) =>
            record.organizationId === input.organizationId &&
            record.accountId === input.accountId &&
            record.createdAt >= input.periodStart &&
            record.createdAt < input.periodEnd,
        )
        .reduce((total, record) => total + (record.actualCostMicrosUsd ?? 0), 0),
    );
  }
}

type RunRow = { payload_json: LlmRunRecord };

export class PostgresLlmRunRepository implements LlmRunRepository {
  constructor(private readonly pool: Pool) {}

  async create(record: LlmRunRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO llm_runs
        (id, organization_id, account_id, agent_id, session_id, task_class, provider,
         model, mode, status, stable_prefix_hash, full_prompt_hash, budget_micros_usd,
         estimated_maximum_cost_micros_usd, actual_cost_micros_usd, created_at,
         updated_at, payload_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)`,
      [
        record.id,
        record.organizationId,
        record.accountId,
        record.agentId,
        record.sessionId,
        record.taskClass,
        record.provider,
        record.model,
        record.mode,
        record.status,
        record.stablePrefixHash,
        record.fullPromptHash,
        record.budgetMicrosUsd,
        record.estimatedMaximumCostMicrosUsd,
        record.actualCostMicrosUsd,
        record.createdAt,
        record.updatedAt,
        JSON.stringify(record),
      ],
    );
  }

  async update(record: LlmRunRecord): Promise<void> {
    const result = await this.pool.query(
      `UPDATE llm_runs
       SET status = $2,
           actual_cost_micros_usd = $3,
           cache_hit_tokens = $4,
           cache_miss_tokens = $5,
           output_tokens = $6,
           cache_hit_ratio_bps = $7,
           provider_request_id = $8,
           output_hash = $9,
           completed_at = $10,
           updated_at = $11,
           payload_json = $12::jsonb
       WHERE id = $1`,
      [
        record.id,
        record.status,
        record.actualCostMicrosUsd,
        record.usage?.cacheHitTokens ?? null,
        record.usage?.cacheMissTokens ?? null,
        record.usage?.outputTokens ?? null,
        record.cacheHitRatioBps,
        record.providerRequestId,
        record.outputHash,
        record.completedAt,
        record.updatedAt,
        JSON.stringify(record),
      ],
    );
    if (result.rowCount !== 1) throw new Error(`LLM run ${record.id} not found.`);
  }

  async get(id: string): Promise<LlmRunRecord | null> {
    const result = await this.pool.query<RunRow>(
      `SELECT payload_json FROM llm_runs WHERE id = $1`,
      [id],
    );
    return result.rows[0]?.payload_json ?? null;
  }

  async list(input: {
    organizationId: string;
    accountId: string;
    limit: number;
  }): Promise<readonly LlmRunRecord[]> {
    const result = await this.pool.query<RunRow>(
      `SELECT payload_json
       FROM llm_runs
       WHERE organization_id = $1 AND account_id = $2
       ORDER BY created_at DESC, id DESC
       LIMIT $3`,
      [input.organizationId, input.accountId, input.limit],
    );
    return result.rows.map((row) => row.payload_json);
  }

  async totalActualCostMicrosUsd(input: {
    organizationId: string;
    accountId: string;
    periodStart: string;
    periodEnd: string;
  }): Promise<number> {
    const result = await this.pool.query<{ total: string }>(
      `SELECT COALESCE(sum(actual_cost_micros_usd), 0)::text AS total
       FROM llm_runs
       WHERE organization_id = $1
         AND account_id = $2
         AND created_at >= $3
         AND created_at < $4
         AND actual_cost_micros_usd IS NOT NULL`,
      [input.organizationId, input.accountId, input.periodStart, input.periodEnd],
    );
    return Number(result.rows[0]?.total ?? "0");
  }
}
