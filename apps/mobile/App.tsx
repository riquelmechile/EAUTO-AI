import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { DashboardScreen } from "./src/features/dashboard/DashboardScreen";
import { InboxScreen } from "./src/features/inbox/InboxScreen";
import { ContentStudioScreen } from "./src/features/content-studio/ContentStudioScreen";
import { LoginScreen } from "./src/features/auth/LoginScreen";
import { api } from "./src/lib/api";
import { sessionStore, type MobileSession } from "./src/lib/session";

type Tab = "dashboard" | "inbox" | "studio";

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [session, setSession] = useState<MobileSession | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    let mounted = true;
    void api
      .session()
      .then((stored) => {
        if (mounted) setSession(stored);
      })
      .finally(() => {
        if (mounted) setLoadingSession(false);
      });
    const unsubscribe = sessionStore.subscribeCleared(() => setSession(null));
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  async function logout(): Promise<void> {
    await api.logout();
    setSession(null);
    setTab("dashboard");
  }

  if (loadingSession) {
    return (
      <SafeAreaView style={styles.centered}>
        <StatusBar style="light" />
        <ActivityIndicator color="#7dd3fc" size="large" />
        <Text style={styles.loadingText}>Validando sesión segura…</Text>
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <LoginScreen onAuthenticated={setSession} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>EAUTO-AI</Text>
          <Text style={styles.subtitle}>Empresa agéntica autónoma</Text>
          <Text style={styles.actor}>{session.actor.id}</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => void logout()} style={styles.logout}>
          <Text style={styles.logoutText}>Salir</Text>
        </Pressable>
      </View>
      <View style={styles.tabs}>
        {(["dashboard", "inbox", "studio"] as const).map((item) => (
          <Pressable
            key={item}
            onPress={() => setTab(item)}
            style={[styles.tab, tab === item && styles.activeTab]}
          >
            <Text style={styles.tabText}>
              {item === "dashboard" ? "Empresa" : item === "inbox" ? "Decisiones" : "Contenido"}
            </Text>
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {tab === "dashboard" ? <DashboardScreen /> : null}
        {tab === "inbox" ? <InboxScreen /> : null}
        {tab === "studio" ? <ContentStudioScreen /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "#0b1120", flex: 1 },
  centered: {
    alignItems: "center",
    backgroundColor: "#0b1120",
    flex: 1,
    gap: 14,
    justifyContent: "center",
  },
  loadingText: { color: "#cbd5e1" },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  brand: { color: "#f8fafc", fontSize: 26, fontWeight: "900", letterSpacing: 1 },
  subtitle: { color: "#7dd3fc", marginTop: 3 },
  actor: { color: "#94a3b8", fontSize: 12, marginTop: 3 },
  logout: {
    backgroundColor: "#1e293b",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  logoutText: { color: "#e2e8f0", fontWeight: "700" },
  tabs: { flexDirection: "row", gap: 8, padding: 16 },
  tab: { alignItems: "center", backgroundColor: "#182033", borderRadius: 12, flex: 1, padding: 11 },
  activeTab: { backgroundColor: "#2563eb" },
  tabText: { color: "white", fontSize: 12, fontWeight: "700" },
  content: { gap: 16, padding: 16, paddingBottom: 36 },
});
