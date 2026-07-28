import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api, type MercadoLibreTaxonomyPreflightResult } from "../../lib/api";
import {
  buildMercadoLibreSubmittedAttributes,
  createMercadoLibreAttributeDraft,
  mercadoLibreTaxonomyReasonLabel,
  mercadoLibreTaxonomyStatusMessage,
  mergeMissingMercadoLibreAttributeDrafts,
  normalizeMercadoLibreCategoryId,
  type MercadoLibreAttributeDraft,
} from "./taxonomyPreflight";

type Props = Readonly<{ accountId: string }>;

export function MercadoLibreTaxonomyPreflight({ accountId }: Props) {
  const nextDraftNumber = useRef(1);
  const [categoryId, setCategoryId] = useState("");
  const [drafts, setDrafts] = useState<readonly MercadoLibreAttributeDraft[]>([]);
  const [result, setResult] = useState<MercadoLibreTaxonomyPreflightResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    "Ingrese una categoría MLC y verifique sus atributos contra la evidencia oficial.",
  );

  function createDraftKey(): string {
    const key = `taxonomy-attribute-${nextDraftNumber.current}`;
    nextDraftNumber.current += 1;
    return key;
  }

  function addAttribute(attributeId = ""): void {
    setDrafts((current) => [
      ...current,
      createMercadoLibreAttributeDraft(createDraftKey(), attributeId),
    ]);
  }

  function updateAttribute(
    key: string,
    field: "id" | "valueId" | "valueName",
    value: string,
  ): void {
    setDrafts((current) =>
      current.map((draft) =>
        draft.key === key ? Object.freeze({ ...draft, [field]: value }) : draft,
      ),
    );
    setResult(null);
  }

  function removeAttribute(key: string): void {
    setDrafts((current) => current.filter((draft) => draft.key !== key));
    setResult(null);
  }

  async function verify(): Promise<void> {
    setBusy(true);
    setMessage("Consultando taxonomía oficial de MercadoLibre Chile…");
    try {
      const normalizedCategoryId = normalizeMercadoLibreCategoryId(categoryId);
      const response = await api.mercadoLibreTaxonomyPreflight(accountId, {
        categoryId: normalizedCategoryId,
        submittedAttributes: buildMercadoLibreSubmittedAttributes(drafts),
      });
      if (response.writesPerformed !== false) {
        throw new Error("El servidor informó una operación de escritura inesperada.");
      }
      if (response.categoryId !== normalizedCategoryId) {
        throw new Error("El servidor devolvió evidencia para otra categoría.");
      }
      setCategoryId(normalizedCategoryId);
      setResult(response);
      setDrafts((current) =>
        mergeMissingMercadoLibreAttributeDrafts(
          current,
          response.missingRequiredAttributeIds,
          createDraftKey,
        ),
      );
      setMessage(mercadoLibreTaxonomyStatusMessage(response));
    } catch (error) {
      setResult(null);
      setMessage(readError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={styles.title}>Preflight de taxonomía</Text>
          <Text style={styles.description}>
            Validación oficial previa. No crea, modifica ni publica productos.
          </Text>
        </View>
        <View style={styles.serverBadge}>
          <Text style={styles.serverBadgeText}>SERVIDOR</Text>
        </View>
      </View>

      <TextInput
        accessibilityLabel="Categoría MercadoLibre Chile"
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!busy}
        onChangeText={(value) => {
          setCategoryId(value.toUpperCase());
          setResult(null);
        }}
        placeholder="MLC1234"
        placeholderTextColor="#64748b"
        style={styles.input}
        value={categoryId}
      />

      <View style={styles.attributeHeading}>
        <Text style={styles.attributeTitle}>Atributos enviados ({drafts.length})</Text>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => addAttribute()}
          style={[styles.smallButton, busy && styles.disabled]}
        >
          <Text style={styles.smallButtonText}>Agregar</Text>
        </Pressable>
      </View>

      {drafts.length === 0 ? (
        <Text style={styles.emptyText}>
          Puede verificar sin atributos; el servidor agregará los IDs obligatorios que falten.
        </Text>
      ) : null}

      {drafts.map((draft, index) => (
        <View key={draft.key} style={styles.attributeCard}>
          <View style={styles.attributeRowHeader}>
            <Text style={styles.attributeNumber}>Atributo {index + 1}</Text>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => removeAttribute(draft.key)}
            >
              <Text style={styles.removeText}>Quitar</Text>
            </Pressable>
          </View>
          <TextInput
            accessibilityLabel={`ID del atributo ${index + 1}`}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!busy}
            onChangeText={(value) => updateAttribute(draft.key, "id", value.toUpperCase())}
            placeholder="Ej. ITEM_CONDITION"
            placeholderTextColor="#64748b"
            style={styles.input}
            value={draft.id}
          />
          <View style={styles.valueRow}>
            <TextInput
              accessibilityLabel={`ID del valor ${index + 1}`}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              onChangeText={(value) => updateAttribute(draft.key, "valueId", value)}
              placeholder="ID del valor"
              placeholderTextColor="#64748b"
              style={[styles.input, styles.valueInput]}
              value={draft.valueId}
            />
            <TextInput
              accessibilityLabel={`Nombre del valor ${index + 1}`}
              autoCapitalize="sentences"
              autoCorrect={false}
              editable={!busy}
              onChangeText={(value) => updateAttribute(draft.key, "valueName", value)}
              placeholder="Nombre del valor"
              placeholderTextColor="#64748b"
              style={[styles.input, styles.valueInput]}
              value={draft.valueName}
            />
          </View>
          <Text style={styles.fieldHint}>Puede completar ID, nombre o ambos.</Text>
        </View>
      ))}

      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void verify()}
        style={[styles.verifyButton, busy && styles.disabled]}
      >
        <Text style={styles.verifyButtonText}>{busy ? "Verificando…" : "Verificar taxonomía"}</Text>
      </Pressable>

      <Text style={styles.message}>{message}</Text>

      {result ? <TaxonomyResult result={result} /> : null}
    </View>
  );
}

function TaxonomyResult({ result }: Readonly<{ result: MercadoLibreTaxonomyPreflightResult }>) {
  return (
    <View style={[styles.result, statusStyle(result.status)]}>
      <Text style={styles.resultStatus}>{statusLabel(result.status)}</Text>
      <Text style={styles.resultMeta}>
        {result.categoryId} · política {result.policyVersion} · {formatDate(result.evaluatedAt)}
      </Text>

      {result.reasons.length > 0 ? (
        <View style={styles.resultList}>
          {result.reasons.map((reason) => (
            <Text key={reason} style={styles.resultItem}>
              • {mercadoLibreTaxonomyReasonLabel(reason)}
            </Text>
          ))}
        </View>
      ) : null}

      {result.missingRequiredAttributeIds.length > 0 ? (
        <ResultIds label="Faltantes obligatorios" values={result.missingRequiredAttributeIds} />
      ) : null}
      {result.invalidAttributeIds.length > 0 ? (
        <ResultIds label="Inválidos o desconocidos" values={result.invalidAttributeIds} />
      ) : null}

      <Text style={styles.noWriteText}>
        Evidencias oficiales: {result.evidenceRefs.length} · escrituras: ninguna
      </Text>
    </View>
  );
}

function ResultIds({ label, values }: Readonly<{ label: string; values: readonly string[] }>) {
  return (
    <View style={styles.idSection}>
      <Text style={styles.idLabel}>{label}</Text>
      <View style={styles.idList}>
        {values.map((value) => (
          <View key={value} style={styles.idBadge}>
            <Text style={styles.idBadgeText}>{value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function statusLabel(status: MercadoLibreTaxonomyPreflightResult["status"]): string {
  switch (status) {
    case "ready":
      return "LISTA · NO PUBLICADA";
    case "blocked":
      return "BLOQUEADA";
    case "incomplete":
      return "INCOMPLETA";
  }
}

function statusStyle(status: MercadoLibreTaxonomyPreflightResult["status"]) {
  switch (status) {
    case "ready":
      return styles.resultReady;
    case "blocked":
      return styles.resultBlocked;
    case "incomplete":
      return styles.resultIncomplete;
  }
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
  section: { borderTopColor: "#334155", borderTopWidth: 1, gap: 10, paddingTop: 14 },
  headingRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  headingCopy: { flex: 1, gap: 4 },
  title: { color: "#f8fafc", fontSize: 15, fontWeight: "800" },
  description: { color: "#94a3b8", fontSize: 12, lineHeight: 18 },
  serverBadge: {
    backgroundColor: "#1e3a8a",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  serverBadgeText: { color: "#bfdbfe", fontSize: 10, fontWeight: "900" },
  input: {
    backgroundColor: "#0f172a",
    borderColor: "#475569",
    borderRadius: 10,
    borderWidth: 1,
    color: "#f8fafc",
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  attributeHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  attributeTitle: { color: "#cbd5e1", fontSize: 13, fontWeight: "700" },
  smallButton: {
    backgroundColor: "#334155",
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  smallButtonText: { color: "#f8fafc", fontSize: 12, fontWeight: "800" },
  emptyText: { color: "#64748b", fontSize: 12, lineHeight: 18 },
  attributeCard: {
    backgroundColor: "#111827",
    borderColor: "#334155",
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    padding: 10,
  },
  attributeRowHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  attributeNumber: { color: "#cbd5e1", fontSize: 12, fontWeight: "800" },
  removeText: { color: "#fca5a5", fontSize: 12, fontWeight: "700" },
  valueRow: { flexDirection: "row", gap: 8 },
  valueInput: { flex: 1 },
  fieldHint: { color: "#64748b", fontSize: 11 },
  verifyButton: {
    alignItems: "center",
    backgroundColor: "#2563eb",
    borderRadius: 12,
    padding: 12,
  },
  verifyButtonText: { color: "#ffffff", fontWeight: "900" },
  disabled: { opacity: 0.4 },
  message: { color: "#bae6fd", fontSize: 12, lineHeight: 19 },
  result: { borderRadius: 12, borderWidth: 1, gap: 8, padding: 11 },
  resultReady: { backgroundColor: "#052e16", borderColor: "#22c55e" },
  resultBlocked: { backgroundColor: "#3f1515", borderColor: "#ef4444" },
  resultIncomplete: { backgroundColor: "#422006", borderColor: "#f59e0b" },
  resultStatus: { color: "#f8fafc", fontSize: 14, fontWeight: "900" },
  resultMeta: { color: "#cbd5e1", fontSize: 11, lineHeight: 17 },
  resultList: { gap: 4 },
  resultItem: { color: "#e2e8f0", fontSize: 12, lineHeight: 18 },
  idSection: { gap: 6 },
  idLabel: { color: "#cbd5e1", fontSize: 11, fontWeight: "800" },
  idList: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  idBadge: {
    backgroundColor: "#0f172a",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  idBadgeText: { color: "#e2e8f0", fontSize: 10, fontWeight: "700" },
  noWriteText: { color: "#94a3b8", fontSize: 11 },
});
