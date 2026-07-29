import { afterEach, describe, expect, it, vi } from "vitest";
import { MiniMaxContentProvider } from "@eauto/content";

const brief = Object.freeze({
  id: "product-1",
  accountId: "plasticov",
  sourceImageUri: "https://files.example.cl/source/product-1.jpg",
  instructions: "Preserve the exact red housing and black handle.",
  requestedChannels: Object.freeze(["mercadolibre" as const]),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MiniMaxContentProvider", () => {
  it("uses the official image endpoint and persists assets privately before returning", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({
          data: { image_urls: ["https://cdn.minimax.io/generated/image.png"] },
          base_resp: { status_code: 0, status_msg: "success" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { "content-type": "image/png", "content-length": "4" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const stored: Array<{
      objectKey: string;
      body: Uint8Array;
      metadata: Readonly<Record<string, string>>;
    }> = [];
    const provider = new MiniMaxContentProvider(
      {
        putGeneratedObject: (input) => {
          stored.push({
            objectKey: input.objectKey,
            body: input.body,
            metadata: input.metadata,
          });
          return Promise.resolve({ objectUri: `s3://eauto/${input.objectKey}` });
        },
      },
      {
        apiKey: "minimax-secret",
        imageModel: "image-01",
        videoModel: "MiniMax-Hailuo-2.3",
        promptVersion: "creative-v1",
        generateVideo: false,
        timeoutMs: 5_000,
        pollIntervalMs: 1_000,
        maximumPolls: 3,
        maximumResponseBytes: 100_000,
        maximumAssetBytes: 1_000_000,
      },
    );

    const assets = await provider.generateLaunchAssets(brief);
    expect(assets.map((asset) => asset.kind)).toEqual(["image", "copy"]);
    expect(assets.every((asset) => asset.uri.startsWith("s3://"))).toBe(true);
    expect(stored).toHaveLength(2);
    expect(stored[0]?.metadata).toMatchObject({ provider: "minimax", model: "image-01" });

    const generationRequest = fetchMock.mock.calls[0];
    const url = requestUrl(generationRequest?.[0]);
    expect(url.origin).toBe("https://api.minimax.io");
    expect(url.pathname).toBe("/v1/image_generation");
    expect(new Headers(generationRequest?.[1]?.headers).get("authorization")).toBe(
      "Bearer minimax-secret",
    );
    const payload = JSON.parse(String(generationRequest?.[1]?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({ model: "image-01", response_format: "url", n: 1 });
  });

  it("fails closed when MiniMax returns a provider error", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          json({ base_resp: { status_code: 1008, status_msg: "insufficient balance" } }),
        ),
    );
    const provider = new MiniMaxContentProvider(
      {
        putGeneratedObject: () => Promise.reject(new Error("storage must not be called")),
      },
      {
        apiKey: "minimax-secret",
        imageModel: "image-01",
        videoModel: "MiniMax-Hailuo-2.3",
        promptVersion: "creative-v1",
        generateVideo: false,
        timeoutMs: 5_000,
        pollIntervalMs: 1_000,
        maximumPolls: 3,
        maximumResponseBytes: 100_000,
        maximumAssetBytes: 1_000_000,
      },
    );
    await expect(provider.generateLaunchAssets(brief)).rejects.toThrow(/insufficient balance/);
  });
});

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL | undefined): URL {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input);
  if (input instanceof Request) return new URL(input.url);
  throw new Error("Expected a captured request URL.");
}
