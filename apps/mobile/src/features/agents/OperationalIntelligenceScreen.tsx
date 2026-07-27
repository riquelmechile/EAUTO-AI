import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Panel } from "../../components/Panel";
import {
  agentOsApi,
  type EvidencePackSummary,
  type IntelligenceReadiness,
  type ShadowProposalSummary,
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
  const [status, setStatus] = useState("Cargando inteligencia operacional…");
  const [busy, setBusy] = useState(false);
  const canDecide = roles.some((role) => role === "owner" || role === "admin");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [ready, evidence, workOrders, proposalResult] = await Promise.all([
        agentOsApi.intelligenceReadiness(accountId),
        agentOsApi.evidencePacks(accountId),
        agentOsApi.workOrders(accountId),
        agentOsApi.proposals(accountId),
      ]);
      setReadiness(ready);
      setPacks(evidence.packs);
      setOrders(workOrders.workOrders);
      setProposals(proposalResult.proposals);
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
        <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondary}>
          <Text style={styles.buttonText}>Actualizar</Text>
        </Pressable>
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
  secondary: { alignItems: "center", backgroundColor: "#334155", borderRadius: 12, padding: 11 },
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
