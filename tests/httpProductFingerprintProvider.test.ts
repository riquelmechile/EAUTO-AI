import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HttpProductFingerprintProvider,
  ProductFingerprintProviderValidationError,
} from "@eauto/infrastructure";

const checksum = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const input = Object.freeze({
  organizationId: "maustian",
  accountId: "plasticov",
  sourceImageUploadId: "upload-1",
  objectUri: "s3://eauto-content/organizations/maustian/accounts/plasticov/upload-1.jpg",
  contentHash: checksum,
  evidenceId: `source-image:upload-1:${checksum}`,
});
const validResponse = Object.freeze({
  schemaVersion: "eauto-product-fingerprint-response-v1",
  sourceImageUploadId: "upload-1",
  checksumSha256Base64: checksum,
  algorithm: "phash-64",
  version: "phash-64-v1",
  value: "01".repeat(32),
  evidenceRef: "provider-controlled-evidence-must-be-ignored",
});

function provider(
  overrides: Partial<ConstructorParameters<typeof HttpProductFingerprintProvider>[0]> = {},
) {
  return new HttpProductFingerprintProvider({
    endpoint: "https://fingerprint.example.com/v1/phash",
    apiKey: "fingerprint-secret",
    providerName: "fingerprint-provider",
    fingerprintVersion: "phash-64-v1",
    timeoutMs: 5_000,
    maximumResponseBytes: 64_000,
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("HttpProductFingerprintProvider", () => {
  it("binds the request to server scope and derives evidence locally", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(validResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const fingerprint = await provider().compute(input);

    expect(fingerprint).toEqual({
      algorithm: "phash-64",
      version: "phash-64-v1",
      value: "01".repeat(32),
      evidenceRef: input.evidenceId,
    });
    const request = fetchMock.mock.calls[0];
    expect(request?.[0]).toBe("https://fingerprint.example.com/v1/phash");
    expect(request?.[1]?.redirect).toBe("error");
    const headers = new Headers(request?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer fingerprint-secret");
    expect(headers.get("idempotency-key")).toMatch(/^fingerprint:[a-f0-9]{64}$/);
    const requestBody = request?.[1]?.body;
    if (typeof requestBody !== "string") throw new Error("Expected a JSON string request body.");
    expect(JSON.parse(requestBody)).toEqual({
      schemaVersion: "eauto-product-fingerprint-request-v1",
      organizationId: "maustian",
      accountId: "plasticov",
      sourceImageUploadId: "upload-1",
      objectUri: input.objectUri,
      checksumSha256Base64: checksum,
    });
  });

  it.each([
    ["schema version", { schemaVersion: "future-response-v2" }, /unsupported schema version/],
    ["upload scope", { sourceImageUploadId: "foreign-upload" }, /another source image upload/],
    [
      "checksum",
      { checksumSha256Base64: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=" },
      /another image checksum/,
    ],
    ["algorithm", { algorithm: "sha256-prefix-64" }, /must return algorithm phash-64/],
    ["version", { version: "phash-64-v2" }, /allowlisted version phash-64-v1/],
    ["value length", { value: "0".repeat(63) }, /exactly 64 binary digits/],
    ["value alphabet", { value: `${"0".repeat(63)}x` }, /exactly 64 binary digits/],
  ])("rejects a response with invalid %s", async (_label, patch, expected) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ ...validResponse, ...patch }), { status: 200 }),
        ),
    );
    await expect(provider().compute(input)).rejects.toThrow(expected);
  });

  it("rejects invalid JSON and controlled HTTP errors", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }))
      .mockResolvedValueOnce(new Response("provider unavailable\nsecret-safe", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(provider().compute(input)).rejects.toBeInstanceOf(
      ProductFingerprintProviderValidationError,
    );
    await expect(provider().compute(input)).rejects.toThrow(/failed with HTTP 503/);
  });

  it("rejects responses beyond the configured byte limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(validResponse), {
          status: 200,
          headers: { "content-length": "4096" },
        }),
      ),
    );
    await expect(provider({ maximumResponseBytes: 1_024 }).compute(input)).rejects.toThrow(
      /exceeds the 1024 byte limit/,
    );
  });

  it("aborts a provider that exceeds the server timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      ),
    );
    const rejection = expect(provider({ timeoutMs: 1_000 }).compute(input)).rejects.toThrow(
      /timed out after 1000 ms/,
    );
    await vi.advanceTimersByTimeAsync(1_001);
    await rejection;
  });

  it("rejects unsafe endpoint and malformed source evidence", async () => {
    expect(() => provider({ endpoint: "http://fingerprint.example.com/v1/phash" })).toThrow(
      /must be an HTTPS URL/,
    );
    await expect(
      provider().compute({
        ...input,
        objectUri: "https://public.example.com/image.jpg",
      }),
    ).rejects.toThrow(/private S3 URI/);
    await expect(provider().compute({ ...input, contentHash: "not-a-checksum" })).rejects.toThrow(
      /base64-encoded SHA-256/,
    );
  });
});
