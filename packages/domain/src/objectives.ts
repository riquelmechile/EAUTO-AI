export type ObjectiveStatus = "active" | "paused" | "completed" | "cancelled";

export type BusinessObjective = Readonly<{
  id: string;
  organizationId: string;
  title: string;
  successMetric: string;
  targetValue: number;
  deadline: string;
  status: ObjectiveStatus;
}>;

export type WorkOrder = Readonly<{
  id: string;
  objectiveId: string;
  assignedAgentId: string;
  title: string;
  expectedUtility: number;
  maxIterations: number;
  timeoutMs: number;
  status: "queued" | "running" | "blocked" | "completed" | "failed";
}>;
