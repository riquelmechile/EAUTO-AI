import type { ContentAsset, ProductLaunchBrief } from "@eauto/domain";
import type { ContentAssetRepository, ContentGenerationPort } from "./ports.js";

export class ContentStudioService {
  constructor(
    private readonly generator: ContentGenerationPort,
    private readonly assets: ContentAssetRepository,
  ) {}

  async createLaunch(brief: ProductLaunchBrief): Promise<readonly ContentAsset[]> {
    if (brief.requestedChannels.length === 0) throw new Error("At least one channel is required.");
    const generated = await this.generator.generateLaunchAssets(brief);
    const requiredKinds = new Set(generated.map((asset) => asset.kind));
    for (const kind of ["image", "copy"] as const) {
      if (!requiredKinds.has(kind))
        throw new Error(`Content provider omitted required ${kind} asset.`);
    }
    for (const asset of generated) await this.assets.save(asset);
    return generated;
  }
}
