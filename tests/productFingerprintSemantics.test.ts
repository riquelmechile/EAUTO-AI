import { describe, expect, it } from "vitest";
import {
  calculateProductFingerprintSimilarityBps,
  calculateVisualSimilarityBps,
  validateProductVisualFingerprint,
} from "@eauto/domain";

describe("product fingerprint semantics", () => {
  it("uses Hamming similarity only for perceptual phash fingerprints", () => {
    const left = "0".repeat(64);
    const oneBitDifferent = `1${"0".repeat(63)}`;

    expect(calculateVisualSimilarityBps(left, oneBitDifferent)).toBe(9_843);
    expect(calculateProductFingerprintSimilarityBps("phash-64", left, oneBitDifferent)).toBe(
      9_843,
    );
  });

  it("treats SHA-256 prefixes as exact-content signals instead of visual similarity", () => {
    const left = "0".repeat(64);
    const oneBitDifferent = `1${"0".repeat(63)}`;

    expect(calculateProductFingerprintSimilarityBps("sha256-prefix-64", left, left)).toBe(10_000);
    expect(calculateProductFingerprintSimilarityBps("sha256-prefix-64", left, oneBitDifferent)).toBe(
      0,
    );
  });

  it("accepts both explicit algorithms and rejects malformed values", () => {
    expect(
      validateProductVisualFingerprint({
        algorithm: "sha256-prefix-64",
        version: "sha256-prefix-v1",
        value: "0".repeat(64),
        evidenceRef: "source-image:1",
      }).algorithm,
    ).toBe("sha256-prefix-64");

    expect(() =>
      validateProductVisualFingerprint({
        algorithm: "phash-64",
        version: "phash-v1",
        value: "not-bits",
        evidenceRef: "source-image:1",
      }),
    ).toThrow(/64 binary digits/);
  });
});
