import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api, type MercadoLibreOrder, type MercadoLibreReputation } from "../../lib/api";

export function MercadoLibreCommercialPanel({
  accountId,
  connected,
  canSync,
}: Readonly<{
  accountId: string;
  connected: boolean;
  canSync: boolean;
}>) {
  const [orders, setOrders] = useState<readonly MercadoLibreOrder[]>([]);
  const [reputation, setReputation] = useState<MercadoLibreReputation | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Sin información comercial sincronizada.");

  const load = useCallback(async () => {
    if (!connected) {
      setOrders([]);
      setReputation(null);
      return;
    }
    try {
      const [orderResult, reputationResult] = await Promise.all([
        api.mercadoLibreOrders(accountId),
        api.mercadoLibreReputation(accountId),
      ]);
      setOrders(orderResult.orders);
      setReputation(reputationResult.reputation);
      setMessage(
        reputationResult.reputation
          ? `Reputación observada ${formatDate(reputationResult.reputation.observedAt)}.`
          : "Cuenta conectada; aún no se ha sincronizado reputación.",
      );
    } catch (error) {
      setMessage(readError(error));
    }
  }, [accountId, connected]);

  useEffect(() => {
    void load();
  }, [load]);

  const grossClp = useMemo(
    () =>
      orders
        .filter((order) => order.currencyId === "CLP")
        .reduce((total, order) => total + order.totalAmountMinor, 0),
    [orders],
  );
  const paidOrders = orders.filter((order) => order.status === "paid");
  const canceledOrders = orders.filter((order) => order.status === "cancelled");

  async function sync(): Promise<void> {
    setBusy(true);
    setMessage("Sincronizando órdenes y reputación…");
    try {
      const result = await api.mercadoLibreCommercialOperationsSync(accountId);
      if (result.writesPerformed !== false) {
        throw new Error("El servidor informó una operación de escritura inesperada.");
      }
      await load();
      setMessage(
        `${result.orderCount} órdenes · ${result.paidOrderCount} pagadas · ${result.canceledOrderCount} canceladas · ${formatMoney(result.grossTotalMinor, result.currencyId)} bruto. Sin escrituras.`,
      );
    } catch (error) {
      setMessage(readError(error));
    } finally {
      setBusy(false);
    }
  }

  if (!connected) return null;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.title}>Operación comercial</Text>
        <Pressable
          accessibilityRole="button"
          disabled={!canSync || busy}
          onPress={() => void sync()}
          style={[styles.syncButton, (!canSync || busy) && styles.disabled]}
        >
          <Text style={styles.syncText}>{busy ? "Actualizando…" : "Actualizar ventas"}</Text>
        </Pressable>
      </View>

      <Text style={styles.message}>{message}</Text>

      <View style={styles.metrics}>
        <Metric label="Órdenes" value={orders.length} />
        <Metric label="Pagadas" value={paidOrders.length} />
        <Metric
          label="Canceladas"
          urgent={canceledOrders.length > 0}
          value={canceledOrders.length}
        />
      </View>

      <View style={styles.metrics}>
        <Metric label="Bruto observado" value={formatMoney(grossClp, "CLP")} />
        <Metric label="Nivel reputación" value={reputation?.levelId ?? "—"} />
        <Metric label="Power seller" value={reputation?.powerSellerStatus ?? "—"} />
      </View>

      {reputation ? (
        <Text style={styles.reputation}>
          {reputation.completedTransactions}/{reputation.totalTransactions} transacciones
          completadas · {formatPercent(reputation.positiveRating)} positivas ·{" "}
          {formatPercent(reputation.negativeRating)} negativas
        </Text>
      ) : null}

      {orders.length > 0 ? (
        <View style={styles.orders}>
          <Text style={styles.subtitle}>Órdenes recientes</Text>
          {orders.slice(0, 8).map((order) => (
            <View key={order.orderId} style={styles.order}>
              <View style={styles.orderHeader}>
                <Text style={styles.orderTitle}>Orden {order.orderId}</Text>
                <Text style={styles.amount}>
                  {formatMoney(order.totalAmountMinor, order.currencyId)}
                </Text>
              </View>
              <Text style={styles.meta}>
                {order.status} · {order.unitCount} unidades · {formatDate(order.dateCreated)}
                {order.packId ? ` · pack ${order.packId}` : ""}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Metric({
  label,
  value,
  urgent = false,
}: Readonly<{ label: string; value: string | number; urgent?: boolean }>) {
  return (
    <View style={[styles.metric, urgent && styles.urgent]}>
      <Text numberOfLines={1} style={styles.metricValue}>
        {value}
      </Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function formatMoney(amountMinor: number, currency: string): string {
  const divisor = currency === "CLP" ? 1 : 100;
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "CLP" ? 0 : 2,
  }).format(amountMinor / divisor);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
}

const styles = StyleSheet.create({
  section: { borderTopColor: "#334155", borderTopWidth: 1, gap: 10, paddingTop: 12 },
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  title: { color: "#f8fafc", fontSize: 15, fontWeight: "800" },
  syncButton: {
    backgroundColor: "#075985",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  syncText: { color: "#e0f2fe", fontSize: 11, fontWeight: "800" },
  disabled: { opacity: 0.4 },
  message: { color: "#bae6fd", fontSize: 12, lineHeight: 18 },
  metrics: { flexDirection: "row", gap: 8 },
  metric: {
    backgroundColor: "#0f172a",
    borderColor: "#334155",
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    padding: 9,
  },
  urgent: { borderColor: "#f97316" },
  metricValue: { color: "#f8fafc", fontSize: 16, fontWeight: "900" },
  metricLabel: { color: "#94a3b8", fontSize: 9, marginTop: 3 },
  reputation: { color: "#cbd5e1", fontSize: 12, lineHeight: 18 },
  orders: { gap: 7 },
  subtitle: { color: "#f8fafc", fontSize: 14, fontWeight: "800" },
  order: {
    backgroundColor: "#0f172a",
    borderColor: "#334155",
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
    padding: 9,
  },
  orderHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  orderTitle: { color: "#e2e8f0", fontWeight: "700" },
  amount: { color: "#7dd3fc", fontWeight: "900" },
  meta: { color: "#94a3b8", fontSize: 11 },
});
