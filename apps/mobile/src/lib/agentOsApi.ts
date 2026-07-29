import { sessionStore, type MobileSession } from "./session";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:3000";
let refreshInFlight: Promise<MobileSession> | null = null;

export type AgentContract = Readonly<{
  id: string;
  version: string;
  label: string;
  level: "ceo" | "director" | "specialist";
  departmentId: string;
  parentAgentId: string | null;
  mission: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  defaultAutonomy: "ask" | "inform" | "autonomous";
  skillIds: readonly string[];
  maximumDailyBudgetMinorClp: number;
  active: boolean;
}>;

export type AgentSkill = Readonly<{
  id: string;
  version: string;
  label: string;
  riskLevel: string;
  requiresHumanApproval: boolean;
}>;

export type AgentWorkSessionSummary = Readonly<{
  id: string;
  agentId: string;
  objectiveId: string;
  status: string;
  requestedAction: string;
  budgetMinorClp: number;
  spentMinorClp: number;
  createdAt: string;
}>;

export type AgentScorecardSummary = Readonly<{
  agentId: string;
  runCount: number;
  completedCount: number;
  verifiedOutcomeCount: number;
  failedCount: number;
  totalCostMinorClp: number;
  recommendedAutonomy: "ask" | "inform" | "autonomous";
}>;

export type AgentPlanPreview = Readonly<{
  objective: string;
  confidence: number;
  requiresClarification: boolean;
  clarificationReason: string | null;
  tasks: readonly Readonly<{
    id: string;
    agentId: string;
    action: string;
    priority: "high" | "medium" | "low";
    requiresApproval: boolean;
    budgetMinorClp: number;
  }>[];
}>;

export type EvidencePackSummary = Readonly<{
  id: string;
  purpose: string;
  subject: string;
  generatedAt: string;
  expiresAt: string;
  complete: boolean;
  missingInputs: readonly string[];
  documents: readonly Readonly<{ kind?: string; authority: string }>[];
}>;

export type WorkOrderSummary = Readonly<{
  id: string;
  agentId: string;
  capability?: string;
  requestedAction: string;
  status: string;
  expectedUtility: number;
  wakeReason: string;
  attempts: number;
  maximumAttempts: number;
  failureReason: string | null;
  createdAt: string;
}>;

export type ShadowProposalSummary = Readonly<{
  id: string;
  agentId: string;
  action: string;
  rationale: string;
  expectedImpactMinorClp: number | null;
  risk: "low" | "medium" | "high" | "critical";
  status: "pending-approval" | "approved" | "rejected" | "superseded";
  requiresHumanApproval: true;
  createdAt: string;
}>;

export type IntelligenceReadiness = Readonly<{
  workerEnabled: boolean;
  llmEnabled: boolean;
  mode: "shadow";
  externalWrites: false;
}>;

export type AccountBrainDimensionSummary = Readonly<{
  dimension: string;
  status: "healthy" | "attention" | "critical" | "insufficient-evidence";
  scoreBps: number | null;
  missingInputs: readonly string[];
  findings: readonly Readonly<{
    id: string;
    title: string;
    severity: "info" | "warning" | "critical";
  }>[];
}>;

export type AccountBrainSummary = Readonly<{
  id: string;
  accountId: string;
  generatedAt: string;
  complete: boolean;
  overallScoreBps: number | null;
  dimensions: readonly AccountBrainDimensionSummary[];
  strategicPriorities: readonly string[];
  missingInputs: readonly string[];
}>;

export type SpecialistDaemonStateSummary = Readonly<{
  daemonId: string;
  enabled: boolean;
  nextRunAt: string;
  lastStatus: "never" | "queued" | "skipped" | "waiting-evidence" | "failed";
  lastError: string | null;
  lastRunAt: string | null;
}>;

export type SupplyWorkflowSummary = Readonly<{
  id: string;
  kind: string;
  supplierId: string;
  listingId: string | null;
  status: string;
  dryRun: true;
  missingInputs: readonly string[];
  createdAt: string;
}>;

export type ProductLifecycleSummary = Readonly<{
  listingId: string;
  state:
    | "active"
    | "seasonal"
    | "off-season"
    | "obsolete-candidate"
    | "insufficient-data"
    | "uncertain";
  confidence: "low" | "medium" | "high";
  reasons: readonly string[];
  missingInputs: readonly string[];
  assessedAt: string;
}>;

export type CreativeLaunchResult = Readonly<{
  assets: readonly Readonly<{ id: string; kind: string; uri: string }>[];
  provider: "minimax";
  publicationPerformed: false;
}>;

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const session = await sessionStore.load();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}),
      ...init.headers,
    },
  });
  if (response.status === 401 && retry && session) {
    await refreshSession(session.refreshToken);
    return request<T>(path, init, false);
  }
  if (!response.ok) throw new Error(`API ${response.status}: ${await response.text()}`);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function refreshSession(refreshToken: string): Promise<MobileSession> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const response = await fetch(`${API_URL}/v1/auth/refresh`, {
      method: "POST",
      headers: { authorization: `Bearer ${refreshToken}` },
    });
    if (!response.ok) {
      await sessionStore.clear();
      throw new Error(`Session refresh failed: ${response.status}`);
    }
    const session = (await response.json()) as MobileSession;
    await sessionStore.save(session);
    return session;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export const agentOsApi = {
  catalog: (accountId: string) =>
    request<{ contracts: readonly AgentContract[]; skills: readonly AgentSkill[] }>(
      `/v1/agent-os/catalog?accountId=${encodeURIComponent(accountId)}`,
    ),
  sessions: (accountId: string) =>
    request<{ sessions: readonly AgentWorkSessionSummary[] }>(
      `/v1/agent-os/${encodeURIComponent(accountId)}/sessions?limit=100`,
    ),
  scorecards: (accountId: string, periodStart: string, periodEnd: string) =>
    request<{ scorecards: readonly AgentScorecardSummary[] }>(
      `/v1/agent-os/${encodeURIComponent(accountId)}/scorecards?periodStart=${encodeURIComponent(periodStart)}&periodEnd=${encodeURIComponent(periodEnd)}`,
    ),
  planCompany: (accountId: string, objective: string, budgetMinorClp: number) =>
    request<AgentPlanPreview>(`/v1/agent-os/${encodeURIComponent(accountId)}/plans/company`, {
      method: "POST",
      body: JSON.stringify({ objective, maximumTasks: 5, budgetMinorClp }),
    }),
  intelligenceReadiness: (accountId: string) =>
    request<IntelligenceReadiness>(`/v1/intelligence/${encodeURIComponent(accountId)}/readiness`),
  evidencePacks: (accountId: string) =>
    request<{ packs: readonly EvidencePackSummary[] }>(
      `/v1/intelligence/${encodeURIComponent(accountId)}/evidence-packs?limit=50`,
    ),
  workOrders: (accountId: string) =>
    request<{ workOrders: readonly WorkOrderSummary[] }>(
      `/v1/intelligence/${encodeURIComponent(accountId)}/work-orders?limit=100`,
    ),
  proposals: (accountId: string) =>
    request<{ proposals: readonly ShadowProposalSummary[] }>(
      `/v1/intelligence/${encodeURIComponent(accountId)}/proposals?limit=100`,
    ),
  decideProposal: (
    accountId: string,
    proposalId: string,
    status: "approved" | "rejected" | "superseded",
  ) =>
    request<{ proposal: ShadowProposalSummary; executionCreated: false }>(
      `/v1/intelligence/${encodeURIComponent(accountId)}/proposals/${encodeURIComponent(proposalId)}/decision`,
      { method: "POST", body: JSON.stringify({ status }) },
    ),
  accountBrain: (accountId: string) =>
    request<AccountBrainSummary>(`/v1/company/${encodeURIComponent(accountId)}/brain`),
  rebuildAccountBrain: (accountId: string, maximumAgeMs = 900_000) =>
    request<AccountBrainSummary>(`/v1/company/${encodeURIComponent(accountId)}/brain/rebuild`, {
      method: "POST",
      body: JSON.stringify({ maximumAgeMs }),
    }),
  initializeDaemons: (accountId: string) =>
    request<void>(`/v1/company/${encodeURIComponent(accountId)}/daemons/initialize`, {
      method: "POST",
    }),
  daemons: (accountId: string) =>
    request<{ catalog: readonly string[]; states: readonly SpecialistDaemonStateSummary[] }>(
      `/v1/company/${encodeURIComponent(accountId)}/daemons`,
    ),
  supplyWorkflows: (accountId: string) =>
    request<{ workflows: readonly SupplyWorkflowSummary[] }>(
      `/v1/company/${encodeURIComponent(accountId)}/supply/workflows?limit=50`,
    ),
  lifecycle: (accountId: string) =>
    request<{ assessments: readonly ProductLifecycleSummary[] }>(
      `/v1/company/${encodeURIComponent(accountId)}/lifecycle?limit=100`,
    ),
  createCreativeLaunch: (
    accountId: string,
    input: Readonly<{
      productId: string;
      sourceImageUploadId: string;
      instructions?: string;
      requestedChannels: readonly ("mercadolibre" | "instagram" | "facebook" | "tiktok" | "owned")[];
    }>,
  ) =>
    request<CreativeLaunchResult>(
      `/v1/company/${encodeURIComponent(accountId)}/creative/launches`,
      { method: "POST", body: JSON.stringify(input) },
    ),
};
