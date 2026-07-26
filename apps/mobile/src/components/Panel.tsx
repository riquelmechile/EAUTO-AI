import type { PropsWithChildren } from "react";
import { StyleSheet, Text, View } from "react-native";

export function Panel({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: "#182033",
    borderColor: "#2b3854",
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  title: { color: "#f8fafc", fontSize: 17, fontWeight: "700" },
});
