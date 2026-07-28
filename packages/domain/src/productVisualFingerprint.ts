export type ProductVisualFingerprint = Readonly<{
  algorithm: "phash-64";
  version: string;
  value: string;
  evidenceRef: string;
}>;

export function validateProductVisualFingerprint(
  fingerprint: ProductVisualFingerprint,
): ProductVisualFingerprint {
  if (fingerprint.algorithm !== "phash-64") {
    throw new Error("Only phash-64 visual fingerprints are supported.");
  }
  if (!fingerprint.version.trim()) throw new Error("Visual fingerprint version is required.");
  if (!/^[01]{64}$/.test(fingerprint.value)) {
    throw new Error("Visual fingerprint value must contain exactly 64 binary digits.");
  }
  if (!fingerprint.evidenceRef.trim()) {
    throw new Error("Visual fingerprint evidenceRef is required.");
  }
  return Object.freeze({ ...fingerprint });
}

export function calculateVisualSimilarityBps(left: string, right: string): number {
  if (!/^[01]{64}$/.test(left) || !/^[01]{64}$/.test(right)) {
    throw new Error("Visual similarity requires two 64-bit binary fingerprints.");
  }
  let equalBits = 0;
  for (let index = 0; index < 64; index += 1) {
    if (left[index] === right[index]) equalBits += 1;
  }
  return Math.trunc((equalBits * 10_000) / 64);
}
