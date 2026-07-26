import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Panel } from "../../components/Panel";
import { api, type Dashboard } from "../../lib/api";

export function DashboardScreen() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.dashboard());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el panel.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data && !error) return <ActivityIndicator size="large" />;
  return (
    <View style={styles.stack}>
      <Panel title="Estado de la empresa">
        <Text style={styles.metric}>{data?.company ?? "EAUTO-AI"}</Text>
        <Text style={styles.copy}>Estado: {data?.status ?? "sin conexión"}</Text>
        <Text style={styles.copy}>Decisiones pendientes: {data?.pendingDecisions ?? "—"}</Text>
      </Panel>
      <Panel title="Cuentas comerciales">
        {data?.accounts.map((account) => (
          <View key={account.id} style={styles.row}>
            <Text style={styles.account}>{account.name}</Text>
            <Text style={styles.badge}>{account.autonomyLevel.toUpperCase()}</Text>
          </View>
        ))}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.button}>
          <Text style={styles.buttonText}>Actualizar</Text>
        </Pressable>
      </Panel>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  metric: { color: "#38bdf8", fontSize: 30, fontWeight: "800" },
  copy: { color: "#cbd5e1", fontSize: 15 },
  row: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  account: { color: "#f8fafc", fontSize: 16, fontWeight: "600" },
  badge: { color: "#fde68a", fontSize: 12, fontWeight: "800" },
  error: { color: "#fca5a5" },
  button: { alignItems: "center", backgroundColor: "#2563eb", borderRadius: 12, padding: 12 },
  buttonText: { color: "white", fontWeight: "700" },
});
