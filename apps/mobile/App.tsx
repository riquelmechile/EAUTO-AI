import { useState } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, Pressable, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { DashboardScreen } from "./src/features/dashboard/DashboardScreen";
import { InboxScreen } from "./src/features/inbox/InboxScreen";
import { ContentStudioScreen } from "./src/features/content-studio/ContentStudioScreen";

type Tab = "dashboard" | "inbox" | "studio";

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.brand}>EAUTO-AI</Text>
        <Text style={styles.subtitle}>Empresa agéntica autónoma</Text>
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
  header: { paddingHorizontal: 20, paddingTop: 18 },
  brand: { color: "#f8fafc", fontSize: 26, fontWeight: "900", letterSpacing: 1 },
  subtitle: { color: "#7dd3fc", marginTop: 3 },
  tabs: { flexDirection: "row", gap: 8, padding: 16 },
  tab: { alignItems: "center", backgroundColor: "#182033", borderRadius: 12, flex: 1, padding: 11 },
  activeTab: { backgroundColor: "#2563eb" },
  tabText: { color: "white", fontSize: 12, fontWeight: "700" },
  content: { gap: 16, padding: 16, paddingBottom: 36 },
});
