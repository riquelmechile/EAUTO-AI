import { describe, expect, it } from "vitest";
import {
  AGENT_SKILL_CATALOG,
  COMPANY_AGENT_CATALOG,
  getCompanyAgentContract,
  planCompanyObjective,
  planDepartmentObjective,
  runAgentPreflight,
} from "@eauto/agent-kernel";
import { AgentOsService } from "@eauto/application";
import { assertValidAgentHierarchy } from "@eauto/domain";
import { InMemoryAgentOsRepository } from "@eauto/infrastructure";

describe("company agent catalog", () => {
  it("contains one CEO and only CEO -> director -> specialist delegation", () => {
    expect(() => assertValidAgentHierarchy(COMPANY_AGENT_CATALOG)).not.toThrow();
    expect(COMPANY_AGENT_CATALOG.filter((agent) => agent.level === "ceo")).toHaveLength(1);
    expect(COMPANY_AGENT_CATALOG.filter((agent) => agent.level === "director")).toHaveLength(7);
    expect(
      COMPANY_AGENT_CATALOG.filter((agent) => agent.level === "specialist").length,
    ).toBeGreaterThan(20);
  });

  it("covers the verified MSL and kiiess manager domains", () => {
    const ids = new Set(COMPANY_AGENT_CATALOG.map((agent) => agent.id));
    for (const expected of [
      "finance-director",
      "portfolio-director",
      "supply-director",
      "operations-director",
      "growth-director",
      "expansion-director",
      "governance-director",
      "pricing",
      "analytics",
      "catalog",
      "supplier-manager",
      "sales-service",
      "image-production",
      "owned-ecommerce",
      "memory-learning",
      "critic-auditor",
      "agent-evaluator",
    ]) {
      expect(ids.has(expected), expected).toBe(true);
    }
  });
});

describe("bounded company planner", () => {
  it("routes the CEO only to directors and caps the plan at five tasks", () => {
    const plan = planCompanyObjective({
      objective:
        "Revisa rentabilidad, stock, reclamos, contenido y expansión web para aumentar ventas",
      maximumTasks: 5,
      budgetMinorClp: 50_000,
    });
    expect(plan.requiresClarification).toBe(false);
    expect(plan.tasks.length).toBeLessThanOrEqual(5);
    for (const task of plan.tasks) {
      expect(getCompanyAgentContract(task.agentId)?.level).toBe("director");
    }
  });

  it("asks for clarification instead of guessing", () => {
    const plan = planCompanyObjective({ objective: "haz la cosa" });
    expect(plan.requiresClarification).toBe(true);
    expect(plan.tasks).toEqual([]);
  });

  it("allows a director to delegate only to its specialists", () => {
    const plan = planDepartmentObjective({
      directorAgentId: "finance-director",
      objective: "analiza margen y propone pricing con costo real",
    });
    expect(plan.tasks.length).toBeGreaterThan(0);
    for (const task of plan.tasks) {
      expect(getCompanyAgentContract(task.agentId)?.parentAgentId).toBe("finance-director");
    }
  });
});

describe("agent preflight", () => {
  const pricing = getCompanyAgentContract("pricing")!;
  const completeEvidence = [
    "economic-snapshot",
    "market-evidence",
    "order-snapshot",
    "cost-evidence",
    "product-source",
  ];

  it("allows a bounded proposal with evidence, policy and budget", () => {
    const report = runAgentPreflight({
      organizationId: "maustian",
      accountId: "plasticov",
      contract: pricing,
      skills: AGENT_SKILL_CATALOG,
      requestedAction: "proposal.create",
      availableEvidenceKinds: completeEvidence,
      autonomy: "inform",
      delegationDepth: 2,
      requestedBudgetMinorClp: 1_000,
      spentTodayMinorClp: 0,
      policyAllowed: true,
      stableContextRefs: ["contract:pricing@1.0.0", "policy:v1"],
      volatileContextRefs: ["evidence:current"],
      generatedAt: "2026-07-27T00:00:00.000Z",
    });
    expect(report.status).toBe("allow");
    expect(report.evidenceComplete).toBe(true);
    expect(report.contractHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("denies marketplace writes, policy violations and excessive budget", () => {
    const report = runAgentPreflight({
      organizationId: "maustian",
      accountId: "plasticov",
      contract: pricing,
      skills: AGENT_SKILL_CATALOG,
      requestedAction: "marketplace.write-unapproved",
      availableEvidenceKinds: completeEvidence,
      autonomy: "autonomous",
      delegationDepth: 2,
      requestedBudgetMinorClp: 50_000,
      spentTodayMinorClp: 10_000,
      policyAllowed: false,
      stableContextRefs: [],
      volatileContextRefs: [],
      generatedAt: "2026-07-27T00:00:00.000Z",
    });
    expect(report.status).toBe("deny");
    expect(report.reasons).toEqual(
      expect.arrayContaining(["capability-not-allowed", "policy-denied", "budget-exceeded"]),
    );
  });

  it("asks for evidence rather than inventing missing inputs", () => {
    const report = runAgentPreflight({
      organizationId: "maustian",
      accountId: "plasticov",
      contract: pricing,
      skills: AGENT_SKILL_CATALOG,
      requestedAction: "proposal.create",
      availableEvidenceKinds: ["market-evidence"],
      autonomy: "inform",
      delegationDepth: 2,
      requestedBudgetMinorClp: 1_000,
      spentTodayMinorClp: 0,
      policyAllowed: true,
      stableContextRefs: [],
      volatileContextRefs: [],
      generatedAt: "2026-07-27T00:00:00.000Z",
    });
    expect(report.status).toBe("ask");
    expect(report.missingEvidenceKinds).toContain("economic-snapshot");
  });
});

describe("Agent OS work sessions", () => {
  it("creates an idempotent CEO session and enforces its budget and lifecycle", async () => {
    let sequence = 0;
    const service = new AgentOsService(
      new InMemoryAgentOsRepository(),
      { now: () => new Date("2026-07-27T01:00:00.000Z") },
      { next: (prefix) => `${prefix}-${++sequence}` },
    );
    const input = {
      organizationId: "maustian",
      accountId: "plasticov",
      objectiveId: "objective-1",
      agentId: "ceo",
      parentSessionId: null,
      requestedAction: "plan.create",
      availableEvidenceKinds: [
        "company-state",
        "policy-version",
        "source-provenance",
        "receipt-chain",
      ],
      evidenceRefs: ["evidence:company-state"],
      autonomy: "inform" as const,
      requestedBudgetMinorClp: 1_000,
      spentTodayMinorClp: 0,
      policyAllowed: true,
      stableContextRefs: ["contract:ceo@1.0.0"],
      volatileContextRefs: ["objective:1"],
      idempotencyKey: "objective-1-ceo-plan",
      deadlineAt: "2026-07-27T02:00:00.000Z",
    };
    const first = await service.createSession(input);
    const duplicate = await service.createSession(input);
    expect(duplicate.session.id).toBe(first.session.id);
    const scope = { organizationId: "maustian", accountId: "plasticov" };
    const running = await service.startSession({ ...scope, sessionId: first.session.id });
    expect(running.status).toBe("running");
    await expect(
      service.heartbeat({
        ...scope,
        sessionId: running.id,
        iterationCount: 1,
        spentMinorClp: 2_000,
      }),
    ).rejects.toThrow(/budget exceeded/i);
    const completed = await service.completeSession({
      ...scope,
      sessionId: running.id,
      outputRefs: ["receipt:verified:plan-1"],
      spentMinorClp: 800,
    });
    expect(completed.status).toBe("completed");
  });

  it("scopes idempotency and session mutations by organization and account", async () => {
    let sequence = 0;
    const service = new AgentOsService(
      new InMemoryAgentOsRepository(),
      { now: () => new Date("2026-07-27T01:00:00.000Z") },
      { next: (prefix) => `${prefix}-${++sequence}` },
    );
    const base = {
      objectiveId: "objective-shared",
      agentId: "ceo",
      parentSessionId: null,
      requestedAction: "plan.create",
      availableEvidenceKinds: [
        "company-state",
        "policy-version",
        "source-provenance",
        "receipt-chain",
      ],
      evidenceRefs: ["evidence:company-state"],
      autonomy: "inform" as const,
      requestedBudgetMinorClp: 0,
      spentTodayMinorClp: 0,
      policyAllowed: true,
      stableContextRefs: ["contract:ceo@1.0.0"],
      volatileContextRefs: ["objective:shared"],
      idempotencyKey: "shared-idempotency-key",
      deadlineAt: "2026-07-27T02:00:00.000Z",
    };
    const first = await service.createSession({
      ...base,
      organizationId: "organization-a",
      accountId: "account-a",
    });
    const second = await service.createSession({
      ...base,
      organizationId: "organization-b",
      accountId: "account-b",
    });
    expect(second.session.id).not.toBe(first.session.id);
    await expect(
      service.startSession({
        organizationId: "organization-b",
        accountId: "account-b",
        sessionId: first.session.id,
      }),
    ).rejects.toThrow(/not found/i);
  });
});
