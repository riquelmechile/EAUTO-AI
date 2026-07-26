import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Panel } from "../../components/Panel";
import { api, type PendingAction } from "../../lib/api";

export function InboxScreen() {
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setError(null);
      setActions((await api.inbox()).actions);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "No fue posible cargar la bandeja.",
      );
    }
  }, []);
  useEffect(() => void load(), [load]);

  return (
    <View style={styles.stack}>
      <Panel title="Bandeja del CEO">
        {actions.length === 0 ? (
          <Text style={styles.empty}>No hay decisiones pendientes.</Text>
        ) : (
          actions.map((action) => (
            <View key={action.id} style={styles.action}>
              <Text style={styles.title}>{action.kind}</Text>
              <Text style={styles.copy}>{action.rationale}</Text>
              <Text style={styles.meta}>
                {action.accountId} · {action.risk} · {action.status}
              </Text>
            </View>
          ))
        )}
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
  action: { borderBottomColor: "#334155", borderBottomWidth: 1, gap: 5, paddingVertical: 10 },
  title: { color: "#f8fafc", fontSize: 16, fontWeight: "700" },
  copy: { color: "#cbd5e1" },
  meta: { color: "#7dd3fc", fontSize: 12 },
  empty: { color: "#94a3b8" },
  error: { color: "#fca5a5" },
  button: { alignItems: "center", backgroundColor: "#2563eb", borderRadius: 12, padding: 12 },
  buttonText: { color: "white", fontWeight: "700" },
});
