import { createHash, randomUUID } from "node:crypto";
import type { ContentAsset, ProductLaunchBrief } from "@eauto/domain";
import type { ContentGenerationPort } from "@eauto/application";

/**
 * Safe development provider. It creates traceable placeholders and never claims
 * that an external image/video model ran. Replace through the ContentGenerationPort.
 */
export class DeterministicContentProvider implements ContentGenerationPort {
  generateLaunchAssets(brief: ProductLaunchBrief): Promise<readonly ContentAsset[]> {
    const createdAt = new Date().toISOString();
    const base = `${brief.id}|${brief.accountId}|${brief.sourceImageUri}|${brief.instructions ?? ""}`;
    const copy = [
      "Título propuesto pendiente de validación de identidad y atributos.",
      "Descripción comercial basada únicamente en evidencia confirmada.",
      `Canales solicitados: ${brief.requestedChannels.join(", ")}.`,
    ].join("\n");

    return Promise.resolve([
      this.asset({
        brief,
        kind: "image",
        uri: `placeholder://content/${brief.id}/hero`,
        material: `${base}|hero`,
        createdAt,
      }),
      this.asset({
        brief,
        kind: "copy",
        uri: `data:text/plain,${encodeURIComponent(copy)}`,
        material: `${base}|${copy}`,
        createdAt,
      }),
    ]);
  }

  private asset(input: {
    brief: ProductLaunchBrief;
    kind: "image" | "copy";
    uri: string;
    material: string;
    createdAt: string;
  }): ContentAsset {
    return Object.freeze({
      id: randomUUID(),
      accountId: input.brief.accountId,
      productId: input.brief.id,
      kind: input.kind,
      uri: input.uri,
      contentHash: createHash("sha256").update(input.material).digest("hex"),
      provider: "deterministic-development",
      model: "none",
      promptVersion: "content-studio-v1",
      moderationStatus: "pending",
      createdAt: input.createdAt,
    });
  }
}
