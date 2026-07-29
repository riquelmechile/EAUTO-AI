import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Panel } from "../../components/Panel";
import {
  agentOsApi,
  type AccountBrainSummary,
  type EvidencePackSummary,
  type IntelligenceReadiness,
  type ProductLifecycleSummary,
  type ShadowProposalSummary,
  type SpecialistDaemonStateSummary,
  type SupplyWorkflowSummary,
  type WorkOrderSummary,
} from "../../lib/agentOsApi";

const ACCOUNTS = [
  { id: "plasticov", label: "Plasticov" },
  { id: "maustian", label: "Maustian" },
] as const;

export function OperationalIntelligenceScreen({ roles }: Readonly<{ roles: readonly string[] }>) {
  const [accountId, setAccountId] = useState("plasticov");
  const [readiness, setReadiness] = useState<IntelligenceReadiness | null>(null);
  const [packs, setPacks] = useState<readonly EvidencePackSummary[]>([]);
  const [orders, setOrders] = useState<readonly WorkOrderSummary[]>([]);
  const [proposals, setProposals] = useState<readonly ShadowProposalSummary[]>([]);
  const [brain, setBrain] = useState<AccountBrainSummary | null>(null);
  const [daemons, setDaemons] = useState<readonly SpecialistDaemonStateSummary[]>([]);
  const [supply, setSupply] = useState<readonly SupplyWorkflowSummary[]>([]);
  const [lifecycle, setLifecycle] = useState<readonly ProductLifecycleSummary[]>([]);
  const [status, setStatus] = useState("Cargando inteligencia operacional…");
  const [busy, setBusy] = useState(false);
  const canDecide = roles.some((role) => role === "owner" || role === "admin");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [
        ready,
        evidence,
        workOrders,
        proposalResult,
        brainResult,
        daemonResult,
        supplyResult,
        lifecycleResult,
      ] = await Promise.all([
        agentOsApi.intelligenceReadiness(accountId),
        agentOsApi.evidencePacks(accountId),
        agentOsApi.workOrders(accountId),
        agentOsApi.proposals(accountId),
        optional(agentOsApi.accountBrain(accountId)),
        optional(agentOsApi.daemons(accountId)),
        optional(agentOsApi.supplyWorkflows(accountId)),
        optional(agentOsApi.lifecycle(accountId)),
      ]);
      setReadiness(ready);
      setPacks(evidence.packs);
      setOrders(workOrders.workOrders);
      setProposals(proposalResult.proposals);
      setBrain(brainResult);
      setDaemons(daemonResult?.states ?? []);
      setSupply(supplyResult?.workflows ?? []);
      setLifecycle(lifecycleResult?.assessments ?? []);
      setStatus(
        ready.workerEnabled && ready.llmEnabled
          ? "Shadow intelligence activa. Todas las propuestas requieren decisión humana."
          : "Runtime visible, pero worker o LLM todavía esperan configuración de producción.",
      );
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy(false);
    }
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function initializeCompanyLayer(): Promise<void> {
    setBusy(true);
    try {
      await agentOsApi.initializeDaemons(accountId);
      await agentOsApi.rebuildAccountBrain(accountId);
      setStatus("Account Brain reconstruido y catálogo de 16 daemons inicializado.");
      await load();
    } catch (error) {
      setStatus(readError(error));
      setBusy(false);
    }
  }

  async function decide(
    proposal: ShadowProposalSummary,
    decision: "approved" | "rejected",
  ): Promise<void> {
    setBusy(true);
    try {
      await agentOsApi.decideProposal(accountId, proposal.id, decision);
      setStatus(
        `${decision === "approved" ? "Propuesta aprobada" : "Propuesta rechazada"}. ` +
          "Ejecución creada: no.",
      );
      await load();
    } catch (error) {
      setStatus(readError(error));
      setBusy(false);
    }
  }

  const pending = proposals.filter((proposal) => proposal.status === "pending-approval");
  const activeOrders = orders.filter((order) =>
    ["queued", "processing", "waiting-evidence", "waiting-approval", "failed"].includes(
      order.status,
    ),
  );
  const activeDaemons = daemons.filter((daemon) => daemon.enabled);
  const blockedDaemons = daemons.filter(
    (daemon) => daemon.lastStatus === "waiting-evidence" || daemon.lastStatus === "failed",
  );
  const lifecycleRisks = lifecycle.filter((assessment) =>
    ["obsolete-candidate", "uncertain", "insufficient-data"].includes(assessment.state),
  );

  return (
    <View style={styles.stack}>
      <Panel title="Inteligencia operacional">
        <Text style={styles.copy}>
          Evidencia autoritativa → memoria consultiva → work order → sesión shadow → propuesta. La
          aprobación nunca ejecuta una mutación por sí sola.
        </Text>
        <View style={styles.accountRow}>
          {ACCOUNTS.map((account) => (
            <Pressable
              accessibilityRole="button"
              key={account.id}
              onPress={() => setAccountId(account.id)}
              style={[styles.accountButton, accountId === account.id && styles.accountButtonActive]}
            >
              <Text style={styles.accountText}>{account.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.metrics}>
          <Metric label="Packs" value={packs.length} />
          <Metric label="Work orders" value={activeOrders.length} />
          <Metric label="Pendientes" value={pending.length} urgent={pending.length > 0} />
        </View>
        <Text style={styles.status}>{busy ? "Procesando…" : status}</Text>
        <Text style={styles.meta}>
          Worker {readiness?.workerEnabled ? "activo" : "inactivo"} · LLM{" "}
          {readiness?.llmEnabled ? "activo" : "inactivo"} · modo {readiness?.mode ?? "—"} ·
          escrituras externas bloqueadas
        </Text>
        <View style={styles.decisionRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => void load()}
            style={styles.secondary}
          >
            <Text style={styles.buttonText}>Actualizar</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!canDecide || busy}
            onPress={() => void initializeCompanyLayer()}
            style={[styles.secondary, (!canDecide || busy) && styles.disabled]}
          >
            <Text style={styles.buttonText}>Inicializar capa empresa</Text>
          </Pressable>
        </View>
      </Panel>

      <Panel title="Account Brain y automatización">
        <View style={styles.metrics}>
          <Metric
            label="Brain"
            value={
              brain?.overallScoreBps === null || !brain
                ? 0
                : Math.round(brain.overallScoreBps / 100)
            }
          />
          <Metric label="Daemons" value={activeDaemons.length} />
          <Metric
            label="Bloqueados"
            value={blockedDaemons.length}
            urgent={blockedDaemons.length > 0}
          />
        </View>
        <Text style={styles.meta}>
          Brain{" "}
          {brain
            ? `${brain.complete ? "completo" : "incompleto"} · ${formatDate(brain.generatedAt)}`
            : "sin snapshot"}
          {brain?.overallScoreBps === null || !brain
            ? ""
            : ` · ${Math.round(brain.overallScoreBps / 100)}%`}
        </Text>
        {brain?.strategicPriorities.length ? (
          brain.strategicPriorities.slice(0, 7).map((priority) => (
            <Text key={priority} style={styles.warning}>
              • {priority}
            </Text>
          ))
        ) : (
          <Text style={styles.empty}>No hay prioridades estratégicas persistidas.</Text>
        )}
        {blockedDaemons.slice(0, 8).map((daemon) => (
          <View key={daemon.daemonId} style={styles.row}>
            <Text style={styles.cardTitle}>
              {daemon.daemonId} · {daemon.lastStatus}
            </Text>
            <Text style={styles.meta}>
              próximo {formatDate(daemon.nextRunAt)}
              {daemon.lastError ? ` · ${daemon.lastError}` : ""}
            </Text>
          </View>
        ))}
      </Panel>

      <Panel title="Supply y ciclo de producto">
        <View style={styles.metrics}>
          <Metric label="Dry-runs" value={supply.length} />
          <Metric label="Productos" value={lifecycle.length} />
          <Metric
            label="Riesgos"
            value={lifecycleRisks.length}
            urgent={lifecycleRisks.length > 0}
          />
        </View>
        {supply.slice(0, 6).map((workflow) => (
          <View key={workflow.id} style={styles.row}>
            <Text style={styles.cardTitle}>
              {workflow.kind} · {workflow.status}
            </Text>
            <Text style={styles.meta}>
              {workflow.supplierId}
              {workflow.listingId ? ` · ${workflow.listingId}` : ""} · dry-run
            </Text>
          </View>
        ))}
        {lifecycleRisks.slice(0, 8).map((assessment) => (
          <View key={`${assessment.listingId}-${assessment.assessedAt}`} style={styles.row}>
            <Text style={styles.cardTitle}>
              {assessment.listingId} · {assessment.state}
            </Text>
            <Text style={styles.meta}>
              {assessment.confidence} · {assessment.reasons.join(" · ")}
            </Text>
          </View>
        ))}
        {supply.length === 0 && lifecycle.length === 0 ? (
          <Text style={styles.empty}>Todavía no hay workflows ni evaluaciones persistidas.</Text>
        ) : null}
      </Panel>

      <Panel title="Bandeja de propuestas">
        {pending.length === 0 ? (
          <Text style={styles.empty}>No hay propuestas pendientes.</Text>
        ) : (
          pending.map((proposal) => (
            <View key={proposal.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{proposal.action}</Text>
                <Text style={[styles.risk, riskStyle(proposal.risk)]}>{proposal.risk}</Text>
              </View>
              <Text style={styles.copy}>{proposal.rationale}</Text>
              <Text style={styles.meta}>
                Agente {proposal.agentId} · impacto esperado{" "}
                {formatImpact(proposal.expectedImpactMinorClp)}
              </Text>
              <View style={styles.decisionRow}>
                <Pressable
                  accessibilityRole="button"
                  disabled={!canDecide || busy}
                  onPress={() => void decide(proposal, "approved")}
                  style={[styles.approve, (!canDecide || busy) && styles.disabled]}
                >
                  <Text style={styles.buttonText}>Aprobar propuesta</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={!canDecide || busy}
                  onPress={() => void decide(proposal, "rejected")}
                  style={[styles.reject, (!canDecide || busy) && styles.disabled]}
                >
                  <Text style={styles.buttonText}>Rechazar</Text>
                </Pressable>
              </View>
              <Text style={styles.warning}>
                Aprobar registra una decisión; no publica ni modifica MercadoLibre.
              </Text>
            </View>
          ))
        )}
      </Panel>

      <Panel title="Evidencia y work orders">
        {packs.slice(0, 8).map((pack) => (
          <View key={pack.id} style={styles.row}>
            <Text style={styles.cardTitle}>
              {pack.subject} · {pack.documents.length} documentos
            </Text>
            <Text style={styles.meta}>
              {pack.complete ? "completo" : `incompleto: ${pack.missingInputs.join(", ")}`} · vence{" "}
              {formatDate(pack.expiresAt)}
            </Text>
          </View>
        ))}
        {activeOrders.slice(0, 12).map((order) => (
          <View key={order.id} style={styles.row}>
            <Text style={styles.cardTitle}>
              {order.agentId} · {order.status}
            </Text>
            <Text style={styles.copy}>{order.requestedAction}</Text>
            <Text style={styles.meta}>
              utilidad {order.expectedUtility.toFixed(2)} · intento {order.attempts}/
              {order.maximumAttempts} · {order.wakeReason}
            </Text>
            {order.failureReason ? <Text style={styles.warning}>{order.failureReason}</Text> : null}
          </View>
        ))}
      </Panel>
    </View>
  );
}

function Metric({
  label,
  value,
  urgent = false,
}: Readonly<{ label: string; value: number; urgent?: boolean }>) {
  return (
    <View style={[styles.metric, urgent && styles.metricUrgent]}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

async function optional<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}

function formatImpact(value: number | null): string {
  if (value === null) return "no cuantificado";
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );
}

function riskStyle(risk: ShadowProposalSummary["risk"]) {
  if (risk === "critical" || risk === "high") return styles.riskHigh;
  if (risk === "medium") return styles.riskMedium;
  return styles.riskLow;
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  copy: { color: "#cbd5e1", lineHeight: 20 },
  status: { color: "#bae6fd", fontSize: 12, lineHeight: 18 },
  meta: { color: "#94a3b8", fontSize: 11, lineHeight: 16 },
  warning: { color: "#fdba74", fontSize: 11, lineHeight: 16 },
  empty: { color: "#94a3b8" },
  accountRow: { flexDirection: "row", gap: 8 },
  accountButton: { backgroundColor: "#334155", borderRadius: 10, flex: 1, padding: 10 },
  accountButtonActive: { backgroundColor: "#2563eb" },
  accountText: { color: "white", fontWeight: "800", textAlign: "center" },
  metrics: { flexDirection: "row", gap: 8 },
  metric: { backgroundColor: "#0f172a", borderRadius: 12, flex: 1, padding: 10 },
  metricUrgent: { borderColor: "#f97316", borderWidth: 1 },
  metricValue: { color: "#7dd3fc", fontSize: 20, fontWeight: "900" },
  metricLabel: { color: "#94a3b8", fontSize: 10 },
  secondary: {
    alignItems: "center",
    backgroundColor: "#334155",
    borderRadius: 12,
    flex: 1,
    padding: 11,
  },
  buttonText: { color: "white", fontWeight: "800" },
  card: { backgroundColor: "#0f172a", borderRadius: 12, gap: 8, padding: 11 },
  cardHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  cardTitle: { color: "#e2e8f0", flex: 1, fontWeight: "800" },
  risk: {
    borderRadius: 999,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 3,
    textTransform: "uppercase",
  },
  riskHigh: { backgroundColor: "#7f1d1d", color: "#fecaca" },
  riskMedium: { backgroundColor: "#78350f", color: "#fde68a" },
  riskLow: { backgroundColor: "#14532d", color: "#bbf7d0" },
  decisionRow: { flexDirection: "row", gap: 8 },
  approve: {
    alignItems: "center",
    backgroundColor: "#166534",
    borderRadius: 10,
    flex: 1,
    padding: 10,
  },
  reject: {
    alignItems: "center",
    backgroundColor: "#991b1b",
    borderRadius: 10,
    flex: 1,
    padding: 10,
  },
  disabled: { opacity: 0.4 },
  row: { borderBottomColor: "#334155", borderBottomWidth: 1, gap: 4, paddingVertical: 9 },
});
