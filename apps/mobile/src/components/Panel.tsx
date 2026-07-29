import type { PropsWithChildren } from "react";
import { StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";

export function Panel({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <View style={styles.panel}>
      <View style={styles.heading}>
        <View style={styles.marker} />
        <Text style={styles.title}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: theme.colors.surfaceElevated,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.large,
    borderWidth: 1,
    elevation: 4,
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
  },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  marker: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.pill,
    height: 8,
    width: 8,
  },
  title: {
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
});
