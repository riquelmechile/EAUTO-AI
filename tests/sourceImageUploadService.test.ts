import { describe, expect, it } from "vitest";
import { UploadValidationError } from "@eauto/domain";
import { SourceImageUploadService, type ObjectStoragePort } from "@eauto/application";
import { InMemorySourceImageUploadRepository } from "@eauto/infrastructure";

const checksum = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function fixture(observed?: Partial<Awaited<ReturnType<ObjectStoragePort["inspectObject"]>>>) {
  const repository = new InMemorySourceImageUploadRepository();
  let now = new Date("2026-07-26T12:00:00.000Z");
  const storage: ObjectStoragePort = {
    createPresignedUpload: (input) =>
      Promise.resolve({
        uploadUrl: `https://uploads.example/${input.objectKey}`,
        requiredHeaders: {
          "content-type": input.contentType,
          "x-amz-checksum-sha256": input.checksumSha256Base64,
        },
      }),
    inspectObject: () =>
      Promise.resolve({
        exists: true,
        sizeBytes: 1024,
        contentType: "image/jpeg",
        checksumSha256Base64: checksum,
        objectUri: "s3://eauto-content/source.jpg",
        ...observed,
      }),
  };
  const service = new SourceImageUploadService(
    repository,
    storage,
    { now: () => now },
    {
      maximumBytes: 10_000_000,
      uploadExpiresInSeconds: 300,
    },
  );
  return { service, setNow: (value: string) => (now = new Date(value)) };
}

const request = {
  id: "source-1",
  organizationId: "maustian",
  accountId: "plasticov",
  originalFileName: "producto.jpg",
  contentType: "image/jpeg" as const,
  sizeBytes: 1024,
  checksumSha256Base64: checksum,
};

describe("SourceImageUploadService", () => {
  it("creates a tenant-scoped signed upload and verifies the stored object", async () => {
    const { service } = fixture();
    const requested = await service.requestUpload(request);
    expect(requested.upload.objectKey).toContain("organizations/maustian/accounts/plasticov");
    expect(requested.requiredHeaders["x-amz-checksum-sha256"]).toBe(checksum);

    const verified = await service.verifyUpload("source-1", "maustian", "plasticov");
    expect(verified.status).toBe("verified");
    expect(verified.objectUri).toBe("s3://eauto-content/source.jpg");
    expect(await service.requireVerified("source-1", "maustian", "plasticov")).toEqual(verified);
  });

  it("rejects checksum mismatches instead of trusting a successful PUT", async () => {
    const { service } = fixture({
      checksumSha256Base64: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
    });
    await service.requestUpload(request);
    await expect(service.verifyUpload("source-1", "maustian", "plasticov")).rejects.toThrow(
      /checksum does not match/,
    );
  });

  it("rejects cross-account verification before inspecting the object", async () => {
    const { service } = fixture();
    await service.requestUpload(request);
    await expect(service.verifyUpload("source-1", "maustian", "maustian")).rejects.toThrow(
      UploadValidationError,
    );
  });

  it("expires uncompleted upload intents", async () => {
    const { service, setNow } = fixture();
    await service.requestUpload(request);
    setNow("2026-07-26T12:06:00.000Z");
    await expect(service.verifyUpload("source-1", "maustian", "plasticov")).rejects.toThrow(
      /window expired/,
    );
  });

  it("blocks oversized and unsupported files before creating a signed URL", async () => {
    const { service } = fixture();
    await expect(service.requestUpload({ ...request, sizeBytes: 20_000_000 })).rejects.toThrow(
      /maximum size/,
    );
    await expect(
      service.requestUpload({ ...request, contentType: "image/gif" as "image/jpeg" }),
    ).rejects.toThrow(/Unsupported content type/);
  });
});
