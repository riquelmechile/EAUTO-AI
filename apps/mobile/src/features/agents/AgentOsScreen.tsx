import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Panel } from "../../components/Panel";
import {
  agentOsApi,
  type AgentContract,
  type AgentPlanPreview,
  type AgentScorecardSummary,
  type AgentWorkSessionSummary,
} from "../../lib/agentOsApi";

const ACCOUNTS = [
  { id: "plasticov", label: "Plasticov" },
  { id: "maustian", label: "Maustian" },
] as const;

export function AgentOsScreen({ roles }: Readonly<{ roles: readonly string[] }>) {
  const [accountId, setAccountId] = useState("plasticov");
  const [contracts, setContracts] = useState<readonly AgentContract[]>([]);
  const [sessions, setSessions] = useState<readonly AgentWorkSessionSummary[]>([]);
  const [scorecards, setScorecards] = useState<readonly AgentScorecardSummary[]>([]);
  const [objective, setObjective] = useState("");
  const [plan, setPlan] = useState<AgentPlanPreview | null>(null);
  const [status, setStatus] = useState("Cargando organización agéntica…");
  const [busy, setBusy] = useState(false);
  const canPlan = roles.some((role) => ["owner", "admin", "operator", "agent"].includes(role));

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const periodEnd = new Date().toISOString();
      const periodStart = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const [catalog, sessionResult, scorecardResult] = await Promise.all([
        agentOsApi.catalog(accountId),
        agentOsApi.sessions(accountId),
        agentOsApi.scorecards(accountId, periodStart, periodEnd),
      ]);
      setContracts(catalog.contracts);
      setSessions(sessionResult.sessions);
      setScorecards(scorecardResult.scorecards);
      setStatus("Agent OS verificado. Las mutaciones externas continúan bloqueadas.");
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy(false);
    }
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const directors = useMemo(
    () => contracts.filter((contract) => contract.level === "director"),
    [contracts],
  );
  const activeSessions = sessions.filter((session) =>
    ["queued", "running", "waiting-evidence", "waiting-approval"].includes(session.status),
  );
  const usedScorecards = scorecards.filter((scorecard) => scorecard.runCount > 0);

  async function createPlan(): Promise<void> {
    if (!objective.trim()) {
      setStatus("Escriba un objetivo concreto antes de planificar.");
      return;
    }
    setBusy(true);
    try {
      const preview = await agentOsApi.planCompany(accountId, objective.trim(), 50_000);
      setPlan(preview);
      setStatus(
        preview.requiresClarification
          ? (preview.clarificationReason ?? "El objetivo requiere aclaración.")
          : "Plan consultivo creado. Aún no se inició ninguna sesión ni acción externa.",
      );
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.stack}>
      <Panel title="Agent OS">
        <Text style={styles.copy}>
          CEO → directores → especialistas. Máximo dos niveles de delegación, preflight obligatorio
          y autonomía inicial ASK.
        </Text>
        <View style={styles.accountRow}>
          {ACCOUNTS.map((account) => (
            <Pressable
              accessibilityRole="button"
              key={account.id}
              onPress={() => {
                setAccountId(account.id);
                setPlan(null);
              }}
              style={[styles.accountButton, accountId === account.id && styles.accountButtonActive]}
            >
              <Text style={styles.accountText}>{account.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.status}>{busy ? "Procesando…" : status}</Text>
        <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondary}>
          <Text style={styles.buttonText}>Actualizar</Text>
        </Pressable>
      </Panel>

      <Panel title="Organización">
        <View style={styles.metrics}>
          <Metric label="CEO" value={contracts.filter((agent) => agent.level === "ceo").length} />
          <Metric label="Directores" value={directors.length} />
          <Metric
            label="Especialistas"
            value={contracts.filter((agent) => agent.level === "specialist").length}
          />
        </View>
        {directors.map((director) => {
          const specialists = contracts.filter(
            (contract) => contract.parentAgentId === director.id && contract.active,
          );
          return (
            <View key={director.id} style={styles.director}>
              <Text style={styles.directorTitle}>{director.label}</Text>
              <Text style={styles.meta}>{director.mission}</Text>
              <Text style={styles.specialists}>
                {specialists.map((specialist) => specialist.label).join(" · ")}
              </Text>
            </View>
          );
        })}
      </Panel>

      <Panel title="Plan CEO consultivo">
        <TextInput
          accessibilityLabel="Objetivo de la empresa"
          multiline
          onChangeText={setObjective}
          placeholder="Ej.: revisa margen, stock y reclamos y prepara un plan priorizado"
          placeholderTextColor="#64748b"
          style={styles.input}
          value={objective}
        />
        <Pressable
          accessibilityRole="button"
          disabled={!canPlan || busy}
          onPress={() => void createPlan()}
          style={[styles.primary, (!canPlan || busy) && styles.disabled]}
        >
          <Text style={styles.buttonText}>Preparar plan</Text>
        </Pressable>
        {plan ? (
          <View style={styles.plan}>
            <Text style={styles.planHeader}>
              Confianza {(plan.confidence * 100).toFixed(0)}% · {plan.tasks.length} tareas
            </Text>
            {plan.tasks.map((task) => {
              const contract = contracts.find((candidate) => candidate.id === task.agentId);
              return (
                <View key={task.id} style={styles.task}>
                  <Text style={styles.taskTitle}>{contract?.label ?? task.agentId}</Text>
                  <Text style={styles.meta}>
                    {task.priority.toUpperCase()} · aprobación {task.requiresApproval ? "sí" : "no"}
                    {" · "}presupuesto {formatClp(task.budgetMinorClp)}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : null}
      </Panel>

      <Panel title="Sesiones y scorecards">
        <View style={styles.metrics}>
          <Metric label="Activas" value={activeSessions.length} />
          <Metric label="Total 30 días" value={sessions.length} />
          <Metric label="Con actividad" value={usedScorecards.length} />
        </View>
        {activeSessions.length === 0 ? (
          <Text style={styles.empty}>No hay sesiones activas.</Text>
        ) : (
          activeSessions.slice(0, 12).map((session) => (
            <View key={session.id} style={styles.task}>
              <Text style={styles.taskTitle}>
                {contracts.find((contract) => contract.id === session.agentId)?.label ??
                  session.agentId}
              </Text>
              <Text style={styles.meta}>
                {session.status} · {session.requestedAction} · {formatClp(session.spentMinorClp)} /{" "}
                {formatClp(session.budgetMinorClp)}
              </Text>
            </View>
          ))
        )}
        {usedScorecards.map((scorecard) => (
          <View key={scorecard.agentId} style={styles.scorecard}>
            <Text style={styles.taskTitle}>
              {contracts.find((contract) => contract.id === scorecard.agentId)?.label ??
                scorecard.agentId}
            </Text>
            <Text style={styles.meta}>
              {scorecard.completedCount}/{scorecard.runCount} completadas · outcomes verificados{" "}
              {scorecard.verifiedOutcomeCount} · recomendación{" "}
              {scorecard.recommendedAutonomy.toUpperCase()}
            </Text>
          </View>
        ))}
      </Panel>
    </View>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function formatClp(value: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(value);
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  copy: { color: "#cbd5e1", lineHeight: 20 },
  status: { color: "#bae6fd", fontSize: 12, lineHeight: 18 },
  accountRow: { flexDirection: "row", gap: 8 },
  accountButton: { backgroundColor: "#334155", borderRadius: 10, flex: 1, padding: 10 },
  accountButtonActive: { backgroundColor: "#2563eb" },
  accountText: { color: "white", fontWeight: "800", textAlign: "center" },
  primary: { alignItems: "center", backgroundColor: "#2563eb", borderRadius: 12, padding: 13 },
  secondary: { alignItems: "center", backgroundColor: "#334155", borderRadius: 12, padding: 11 },
  disabled: { opacity: 0.4 },
  buttonText: { color: "white", fontWeight: "800" },
  metrics: { flexDirection: "row", gap: 8 },
  metric: { backgroundColor: "#0f172a", borderRadius: 12, flex: 1, padding: 10 },
  metricValue: { color: "#7dd3fc", fontSize: 20, fontWeight: "900" },
  metricLabel: { color: "#94a3b8", fontSize: 10, marginTop: 2 },
  director: { borderBottomColor: "#334155", borderBottomWidth: 1, gap: 4, paddingVertical: 10 },
  directorTitle: { color: "#f8fafc", fontWeight: "800" },
  specialists: { color: "#7dd3fc", fontSize: 11, lineHeight: 17 },
  meta: { color: "#94a3b8", fontSize: 11, lineHeight: 16 },
  input: {
    backgroundColor: "#0f172a",
    borderColor: "#334155",
    borderRadius: 12,
    borderWidth: 1,
    color: "white",
    minHeight: 100,
    padding: 12,
    textAlignVertical: "top",
  },
  plan: { gap: 8 },
  planHeader: { color: "#fde68a", fontWeight: "800" },
  task: { backgroundColor: "#0f172a", borderRadius: 10, gap: 3, padding: 9 },
  taskTitle: { color: "#e2e8f0", fontWeight: "700" },
  empty: { color: "#94a3b8" },
  scorecard: { borderColor: "#334155", borderRadius: 10, borderWidth: 1, gap: 3, padding: 9 },
});
