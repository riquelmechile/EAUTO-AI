import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { AgentPreflightReport, AgentWorkSession } from "@eauto/domain";
import type { AgentOsRepository, AgentOsScope } from "@eauto/application";

function scopeKey(input: AgentOsScope): string {
  return `${input.organizationId}\u0000${input.accountId}`;
}

function idempotencyKey(input: AgentOsScope & { idempotencyKey: string }): string {
  return `${scopeKey(input)}\u0000${input.idempotencyKey}`;
}

export class InMemoryAgentOsRepository implements AgentOsRepository {
  private readonly preflights: AgentPreflightReport[] = [];
  private readonly sessions = new Map<string, AgentWorkSession>();
  private readonly sessionByIdempotency = new Map<string, string>();

  savePreflight(report: AgentPreflightReport): Promise<void> {
    this.preflights.push(report);
    return Promise.resolve();
  }

  listPreflights(
    input: AgentOsScope & { limit: number },
  ): Promise<readonly AgentPreflightReport[]> {
    return Promise.resolve(
      Object.freeze(
        this.preflights
          .filter(
            (report) =>
              report.organizationId === input.organizationId &&
              report.accountId === input.accountId,
          )
          .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
          .slice(0, input.limit),
      ),
    );
  }

  createSession(session: AgentWorkSession): Promise<AgentWorkSession> {
    const key = idempotencyKey(session);
    const existingId = this.sessionByIdempotency.get(key);
    if (existingId) return Promise.resolve(this.sessions.get(existingId)!);
    this.sessions.set(session.id, session);
    this.sessionByIdempotency.set(key, session.id);
    return Promise.resolve(session);
  }

  getSession(input: AgentOsScope & { sessionId: string }): Promise<AgentWorkSession | null> {
    const session = this.sessions.get(input.sessionId);
    if (
      !session ||
      session.organizationId !== input.organizationId ||
      session.accountId !== input.accountId
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve(session);
  }

  getSessionByIdempotencyKey(
    input: AgentOsScope & { idempotencyKey: string },
  ): Promise<AgentWorkSession | null> {
    const id = this.sessionByIdempotency.get(idempotencyKey(input));
    return Promise.resolve(id ? (this.sessions.get(id) ?? null) : null);
  }

  updateSession(session: AgentWorkSession): Promise<void> {
    const existing = this.sessions.get(session.id);
    if (
      !existing ||
      existing.organizationId !== session.organizationId ||
      existing.accountId !== session.accountId
    ) {
      throw new Error(`Agent session ${session.id} not found.`);
    }
    this.sessions.set(session.id, session);
    return Promise.resolve();
  }

  listSessions(input: AgentOsScope & { limit: number }): Promise<readonly AgentWorkSession[]> {
    return Promise.resolve(
      Object.freeze(
        [...this.sessions.values()]
          .filter(
            (session) =>
              session.organizationId === input.organizationId &&
              session.accountId === input.accountId,
          )
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .slice(0, input.limit),
      ),
    );
  }
}

type PreflightRow = { payload_json: AgentPreflightReport };
type SessionRow = { payload_json: AgentWorkSession };

export class PostgresAgentOsRepository implements AgentOsRepository {
  constructor(private readonly pool: Pool) {}

  async savePreflight(report: AgentPreflightReport): Promise<void> {
    const id = createHash("sha256").update(JSON.stringify(report), "utf8").digest("hex");
    await this.pool.query(
      `INSERT INTO agent_preflight_reports
        (id, organization_id, account_id, agent_id, requested_action, status,
         contract_hash, generated_at, payload_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [
        id,
        report.organizationId,
        report.accountId,
        report.agentId,
        report.requestedAction,
        report.status,
        report.contractHash,
        report.generatedAt,
        JSON.stringify(report),
      ],
    );
  }

  async listPreflights(
    input: AgentOsScope & { limit: number },
  ): Promise<readonly AgentPreflightReport[]> {
    const result = await this.pool.query<PreflightRow>(
      `SELECT payload_json
       FROM agent_preflight_reports
       WHERE organization_id = $1 AND account_id = $2
       ORDER BY generated_at DESC, id DESC
       LIMIT $3`,
      [input.organizationId, input.accountId, input.limit],
    );
    return result.rows.map((row) => row.payload_json);
  }

  async createSession(session: AgentWorkSession): Promise<AgentWorkSession> {
    await this.pool.query(
      `INSERT INTO agent_work_sessions
        (id, organization_id, account_id, objective_id, agent_id, parent_session_id,
         delegation_depth, status, requested_action, idempotency_key, budget_minor_clp,
         spent_minor_clp, deadline_at, created_at, updated_at, payload_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
       ON CONFLICT (organization_id, account_id, idempotency_key) DO NOTHING`,
      [
        session.id,
        session.organizationId,
        session.accountId,
        session.objectiveId,
        session.agentId,
        session.parentSessionId,
        session.delegationDepth,
        session.status,
        session.requestedAction,
        session.idempotencyKey,
        session.budgetMinorClp,
        session.spentMinorClp,
        session.deadlineAt,
        session.createdAt,
        session.updatedAt,
        JSON.stringify(session),
      ],
    );
    const existing = await this.getSessionByIdempotencyKey({
      organizationId: session.organizationId,
      accountId: session.accountId,
      idempotencyKey: session.idempotencyKey,
    });
    if (!existing) throw new Error("Agent session could not be persisted.");
    return existing;
  }

  async getSession(input: AgentOsScope & { sessionId: string }): Promise<AgentWorkSession | null> {
    const result = await this.pool.query<SessionRow>(
      `SELECT payload_json
       FROM agent_work_sessions
       WHERE id = $1 AND organization_id = $2 AND account_id = $3`,
      [input.sessionId, input.organizationId, input.accountId],
    );
    return result.rows[0]?.payload_json ?? null;
  }

  async getSessionByIdempotencyKey(
    input: AgentOsScope & { idempotencyKey: string },
  ): Promise<AgentWorkSession | null> {
    const result = await this.pool.query<SessionRow>(
      `SELECT payload_json
       FROM agent_work_sessions
       WHERE organization_id = $1 AND account_id = $2 AND idempotency_key = $3`,
      [input.organizationId, input.accountId, input.idempotencyKey],
    );
    return result.rows[0]?.payload_json ?? null;
  }

  async updateSession(session: AgentWorkSession): Promise<void> {
    const result = await this.pool.query(
      `UPDATE agent_work_sessions
       SET status = $4,
           spent_minor_clp = $5,
           updated_at = $6,
           payload_json = $7::jsonb
       WHERE id = $1 AND organization_id = $2 AND account_id = $3`,
      [
        session.id,
        session.organizationId,
        session.accountId,
        session.status,
        session.spentMinorClp,
        session.updatedAt,
        JSON.stringify(session),
      ],
    );
    if (result.rowCount !== 1) throw new Error(`Agent session ${session.id} not found.`);
  }

  async listSessions(
    input: AgentOsScope & { limit: number },
  ): Promise<readonly AgentWorkSession[]> {
    const result = await this.pool.query<SessionRow>(
      `SELECT payload_json
       FROM agent_work_sessions
       WHERE organization_id = $1 AND account_id = $2
       ORDER BY created_at DESC, id DESC
       LIMIT $3`,
      [input.organizationId, input.accountId, input.limit],
    );
    return result.rows.map((row) => row.payload_json);
  }
}
