import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DisabledContentProvider,
  HttpContentProvider,
  type GeneratedAssetStorage,
} from "../packages/content/src/httpContentProvider.js";

const brief = Object.freeze({
  id: "launch_1",
  accountId: "plasticov",
  sourceImageUri: "s3://eauto-content/source/image.jpg",
  knownCostMinor: 8_000,
  stock: 12,
  instructions: "Create a professional listing.",
  requestedChannels: Object.freeze(["mercadolibre", "instagram"] as const),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpContentProvider", () => {
  it("downloads generated media, verifies hashes and stores every asset privately", async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            assets: [
              {
                kind: "image",
                url: "https://assets.example.com/generated.png",
                model: "image-model-v1",
                promptVersion: "listing-hero-v3",
                moderationStatus: "approved",
              },
              {
                kind: "copy",
                text: "Título y descripción comercial verificables.",
                model: "copy-model-v1",
                promptVersion: "listing-copy-v4",
                moderationStatus: "approved",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(png, {
          status: 200,
          headers: {
            "content-type": "image/png",
            "content-length": String(png.byteLength),
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const stored: Parameters<GeneratedAssetStorage["putGeneratedObject"]>[0][] = [];
    const storage: GeneratedAssetStorage = {
      putGeneratedObject: (input) => {
        stored.push(input);
        return Promise.resolve({ objectUri: `s3://eauto-content/${input.objectKey}` });
      },
    };
    const provider = new HttpContentProvider(storage, {
      endpoint: "https://content.example.com/v1/generate",
      apiKey: "content-secret",
      providerName: "test-content",
      timeoutMs: 5_000,
      maximumResponseBytes: 100_000,
      maximumAssetBytes: 1_000_000,
    });

    const assets = await provider.generateLaunchAssets(brief);

    expect(assets).toHaveLength(2);
    expect(assets.map((asset) => asset.kind)).toEqual(["image", "copy"]);
    expect(assets.every((asset) => asset.uri.startsWith("s3://eauto-content/"))).toBe(true);
    expect(assets.every((asset) => asset.provider === "test-content")).toBe(true);
    expect(stored).toHaveLength(2);
    expect(stored[0]?.contentType).toBe("image/png");
    expect(stored[1]?.contentType).toBe("text/plain; charset=utf-8");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requestHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(requestHeaders.get("authorization")).toBe("Bearer content-secret");
    expect(requestHeaders.get("idempotency-key")).toBe("content:plasticov:launch_1");
  });

  it("rejects responses that omit required image or copy assets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            assets: [
              {
                kind: "copy",
                text: "Only copy.",
                model: "copy-model-v1",
                promptVersion: "copy-v1",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const provider = new HttpContentProvider(
      {
        putGeneratedObject: () => Promise.resolve({ objectUri: "s3://unused" }),
      },
      {
        endpoint: "https://content.example.com/v1/generate",
        apiKey: "content-secret",
        providerName: "test-content",
        timeoutMs: 5_000,
        maximumResponseBytes: 100_000,
        maximumAssetBytes: 1_000_000,
      },
    );

    await expect(provider.generateLaunchAssets(brief)).rejects.toThrow(/omitted required image/);
  });

  it("does not create deterministic placeholders when production content is disabled", async () => {
    await expect(new DisabledContentProvider().generateLaunchAssets(brief)).rejects.toThrow(
      /External content generation is disabled/,
    );
  });
});
