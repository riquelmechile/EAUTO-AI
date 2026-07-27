import type {
  AgentAutonomyLevel,
  AgentPlan,
  AgentPreflightReport,
  AgentScorecard,
  AgentWorkSession,
} from "@eauto/domain";
import {
  AGENT_SKILL_CATALOG,
  COMPANY_AGENT_CATALOG,
  getCompanyAgentContract,
  planCompanyObjective,
  planDepartmentObjective,
  runAgentPreflight,
} from "@eauto/agent-kernel";

export interface AgentOsRepository {
  savePreflight(report: AgentPreflightReport): Promise<void>;
  listPreflights(accountId: string, limit: number): Promise<readonly AgentPreflightReport[]>;
  createSession(session: AgentWorkSession): Promise<AgentWorkSession>;
  getSession(sessionId: string): Promise<AgentWorkSession | null>;
  getSessionByIdempotencyKey(idempotencyKey: string): Promise<AgentWorkSession | null>;
  updateSession(session: AgentWorkSession): Promise<void>;
  listSessions(accountId: string, limit: number): Promise<readonly AgentWorkSession[]>;
}

export class AgentOsService {
  constructor(
    private readonly repository: AgentOsRepository,
    private readonly clock: { now(): Date },
    private readonly ids: { next(prefix: string): string },
  ) {}

  catalog() {
    return Object.freeze({
      contracts: COMPANY_AGENT_CATALOG,
      skills: AGENT_SKILL_CATALOG,
    });
  }

  planCompany(input: {
    objective: string;
    maximumTasks?: number;
    budgetMinorClp?: number;
  }): AgentPlan {
    return planCompanyObjective(input);
  }

  planDepartment(input: {
    directorAgentId: string;
    objective: string;
    maximumTasks?: number;
    budgetMinorClp?: number;
  }): AgentPlan {
    return planDepartmentObjective(input);
  }

  async preflight(input: {
    organizationId: string;
    accountId: string;
    agentId: string;
    requestedAction: string;
    availableEvidenceKinds: readonly string[];
    autonomy: AgentAutonomyLevel;
    requestedBudgetMinorClp: number;
    spentTodayMinorClp: number;
    policyAllowed: boolean;
    stableContextRefs: readonly string[];
    volatileContextRefs: readonly string[];
  }): Promise<AgentPreflightReport> {
    const contract = requireContract(input.agentId);
    const report = runAgentPreflight({
      ...input,
      contract,
      skills: AGENT_SKILL_CATALOG,
      delegationDepth: depthFor(contract.level),
      generatedAt: this.clock.now().toISOString(),
    });
    await this.repository.savePreflight(report);
    return report;
  }

  async createSession(input: {
    organizationId: string;
    accountId: string;
    objectiveId: string;
    agentId: string;
    parentSessionId?: string | null;
    requestedAction: string;
    availableEvidenceKinds: readonly string[];
    evidenceRefs: readonly string[];
    autonomy: AgentAutonomyLevel;
    requestedBudgetMinorClp: number;
    spentTodayMinorClp: number;
    policyAllowed: boolean;
    stableContextRefs: readonly string[];
    volatileContextRefs: readonly string[];
    idempotencyKey: string;
    deadlineAt: string;
  }): Promise<Readonly<{ session: AgentWorkSession; preflight: AgentPreflightReport }>> {
    const existing = await this.repository.getSessionByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return {
        session: existing,
        preflight: await this.preflight({
          ...input,
          requestedBudgetMinorClp: existing.budgetMinorClp,
        }),
      };
    }

    const contract = requireContract(input.agentId);
    await this.assertParentSession(contract.parentAgentId, input.parentSessionId ?? null);
    const preflight = await this.preflight(input);
    if (preflight.status === "deny") {
      throw new Error(`Agent preflight denied: ${preflight.reasons.join(", ")}.`);
    }

    const now = this.clock.now().toISOString();
    const status =
      preflight.status === "allow"
        ? "queued"
        : preflight.missingEvidenceKinds.length > 0
          ? "waiting-evidence"
          : "waiting-approval";
    const session = Object.freeze({
      id: this.ids.next("agent-session"),
      organizationId: input.organizationId,
      accountId: input.accountId,
      objectiveId: input.objectiveId,
      agentId: input.agentId,
      parentSessionId: input.parentSessionId ?? null,
      delegationDepth: depthFor(contract.level),
      status,
      requestedAction: input.requestedAction,
      expectedEvidenceKinds:
        preflight.missingEvidenceKinds.length > 0
          ? preflight.missingEvidenceKinds
          : contract.requiredEvidenceKinds,
      evidenceRefs: Object.freeze([...input.evidenceRefs]),
      outputRefs: Object.freeze([]),
      policyVersion: "company-policy-v1",
      skillVersions: Object.freeze(
        contract.skillIds.map((skillId) => {
          const skill = AGENT_SKILL_CATALOG.find((candidate) => candidate.id === skillId);
          if (!skill) throw new Error(`Unknown skill ${skillId}.`);
          return `${skill.id}@${skill.version}`;
        }),
      ),
      promptPrefixHash: preflight.contractHash,
      idempotencyKey: input.idempotencyKey,
      budgetMinorClp: input.requestedBudgetMinorClp,
      spentMinorClp: 0,
      maximumIterations: contract.maximumIterations,
      iterationCount: 0,
      startedAt: null,
      heartbeatAt: null,
      deadlineAt: input.deadlineAt,
      completedAt: null,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
    } satisfies AgentWorkSession);
    return { session: await this.repository.createSession(session), preflight };
  }

  async startSession(sessionId: string): Promise<AgentWorkSession> {
    const session = await this.requireSession(sessionId);
    if (session.status !== "queued") {
      throw new Error(`Agent session ${sessionId} cannot start from ${session.status}.`);
    }
    const now = this.clock.now().toISOString();
    return this.persist({
      ...session,
      status: "running",
      startedAt: now,
      heartbeatAt: now,
      updatedAt: now,
    });
  }

  async heartbeat(input: {
    sessionId: string;
    iterationCount: number;
    spentMinorClp: number;
  }): Promise<AgentWorkSession> {
    const session = await this.requireSession(input.sessionId);
    if (session.status !== "running") throw new Error("Only running sessions accept heartbeats.");
    if (input.iterationCount > session.maximumIterations)
      throw new Error("Maximum iterations exceeded.");
    if (input.spentMinorClp > session.budgetMinorClp) throw new Error("Session budget exceeded.");
    const now = this.clock.now().toISOString();
    return this.persist({
      ...session,
      heartbeatAt: now,
      iterationCount: input.iterationCount,
      spentMinorClp: input.spentMinorClp,
      updatedAt: now,
    });
  }

  async completeSession(input: {
    sessionId: string;
    outputRefs: readonly string[];
    spentMinorClp: number;
  }): Promise<AgentWorkSession> {
    const session = await this.requireSession(input.sessionId);
    if (session.status !== "running") throw new Error("Only running sessions can complete.");
    if (input.outputRefs.length === 0)
      throw new Error("Completed sessions require output references.");
    if (input.spentMinorClp > session.budgetMinorClp) throw new Error("Session budget exceeded.");
    const now = this.clock.now().toISOString();
    return this.persist({
      ...session,
      status: "completed",
      outputRefs: Object.freeze([...input.outputRefs]),
      spentMinorClp: input.spentMinorClp,
      completedAt: now,
      heartbeatAt: now,
      updatedAt: now,
    });
  }

  async failSession(input: { sessionId: string; reason: string }): Promise<AgentWorkSession> {
    const session = await this.requireSession(input.sessionId);
    if (!["queued", "running", "waiting-evidence", "waiting-approval"].includes(session.status)) {
      throw new Error(`Agent session ${input.sessionId} cannot fail from ${session.status}.`);
    }
    const now = this.clock.now().toISOString();
    return this.persist({
      ...session,
      status: "failed",
      failureReason: sanitizeReason(input.reason),
      completedAt: now,
      updatedAt: now,
    });
  }

  listSessions(accountId: string, limit = 100): Promise<readonly AgentWorkSession[]> {
    return this.repository.listSessions(accountId, Math.min(500, Math.max(1, limit)));
  }

  listPreflights(accountId: string, limit = 100): Promise<readonly AgentPreflightReport[]> {
    return this.repository.listPreflights(accountId, Math.min(500, Math.max(1, limit)));
  }

  async scorecards(input: {
    organizationId: string;
    accountId: string;
    periodStart: string;
    periodEnd: string;
  }): Promise<readonly AgentScorecard[]> {
    const sessions = await this.repository.listSessions(input.accountId, 10_000);
    return COMPANY_AGENT_CATALOG.map((contract) => {
      const relevant = sessions.filter(
        (session) =>
          session.organizationId === input.organizationId &&
          session.agentId === contract.id &&
          session.createdAt >= input.periodStart &&
          session.createdAt <= input.periodEnd,
      );
      const completed = relevant.filter((session) => session.status === "completed");
      const verified = completed.filter((session) =>
        session.outputRefs.some((reference) => reference.startsWith("receipt:verified:")),
      );
      const generatedAt = this.clock.now().toISOString();
      return Object.freeze({
        organizationId: input.organizationId,
        accountId: input.accountId,
        agentId: contract.id,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        runCount: relevant.length,
        completedCount: completed.length,
        verifiedOutcomeCount: verified.length,
        failedCount: relevant.filter((session) => session.status === "failed").length,
        policyViolationCount: 0,
        humanCorrectionCount: 0,
        totalCostMinorClp: relevant.reduce((total, session) => total + session.spentMinorClp, 0),
        verifiedOutcomeValueMinorClp: 0,
        cacheHitTokens: 0,
        cacheMissTokens: 0,
        outputTokens: 0,
        recommendedAutonomy: recommendAutonomy(relevant.length, verified.length),
        generatedAt,
      } satisfies AgentScorecard);
    });
  }

  private async assertParentSession(
    expectedParentAgentId: string | null,
    parentSessionId: string | null,
  ): Promise<void> {
    if (expectedParentAgentId === null) {
      if (parentSessionId !== null)
        throw new Error("The CEO session cannot have a parent session.");
      return;
    }
    if (!parentSessionId) throw new Error("Delegated sessions require a parent session.");
    const parent = await this.requireSession(parentSessionId);
    if (parent.agentId !== expectedParentAgentId) {
      throw new Error(
        `Expected parent agent ${expectedParentAgentId}; received ${parent.agentId}.`,
      );
    }
  }

  private async requireSession(sessionId: string): Promise<AgentWorkSession> {
    const session = await this.repository.getSession(sessionId);
    if (!session) throw new Error(`Agent session ${sessionId} not found.`);
    return session;
  }

  private async persist(session: AgentWorkSession): Promise<AgentWorkSession> {
    const frozen = Object.freeze(session);
    await this.repository.updateSession(frozen);
    return frozen;
  }
}

function requireContract(agentId: string) {
  const contract = getCompanyAgentContract(agentId);
  if (!contract) throw new Error(`Unknown company agent ${agentId}.`);
  return contract;
}

function depthFor(level: "ceo" | "director" | "specialist"): 0 | 1 | 2 {
  return level === "ceo" ? 0 : level === "director" ? 1 : 2;
}

function recommendAutonomy(runCount: number, verifiedOutcomeCount: number): AgentAutonomyLevel {
  if (runCount >= 30 && verifiedOutcomeCount === runCount) return "autonomous";
  if (runCount >= 10 && verifiedOutcomeCount === runCount) return "inform";
  return "ask";
}

function sanitizeReason(reason: string): string {
  return reason
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 500);
}
