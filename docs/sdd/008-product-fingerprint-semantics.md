# SDD 008 — Product Fingerprint Semantics

## Intent

Prevent cryptographic content hashes from being interpreted as perceptual visual similarity.

A fingerprint algorithm is part of the evidence contract. Its name determines which comparisons are valid and which conclusions may be drawn from the result.

## Supported algorithms

### `phash-64`

- Reserved for a provider that explicitly computes a 64-bit perceptual image hash.
- Hamming distance is converted to integer basis points.
- Identical fingerprints score 10,000.
- A one-bit difference scores 9,843.
- It may be used as a visual duplicate signal, never as sole product identity evidence.

### `sha256-prefix-64`

- Deterministic development and exact-content signal.
- Contains the first 64 bits of a SHA-256 digest derived from the verified content checksum.
- Equality scores 10,000.
- Any different value scores zero.
- It must never be described or evaluated as perceptual similarity.

## Storage and migration

Migration 030 expands the persisted algorithm contract and reclassifies rows produced by `deterministic-sha256-prefix-v1` from `phash-64` to `sha256-prefix-64`.

The fingerprint value, evidence reference, identification lifecycle and human review remain unchanged. Only the algorithm semantics are corrected.

## Query invariants

- Comparisons require the same organization, account, algorithm and version.
- `phash-64` uses Hamming similarity.
- `sha256-prefix-64` uses exact equality only.
- Algorithms are never compared across types or versions.
- A zero score remains evidence of non-equality, not evidence that products are unrelated.

## Fail-closed behavior

- Unknown algorithms are rejected.
- Malformed values are rejected before persistence or comparison.
- A cryptographic hash cannot pass a perceptual duplicate threshold merely because many bits happen to match.
- A live provider cannot label arbitrary content hashes as `phash-64`.
- Product identity still requires the candidate evidence chain and terminal human review.

## Acceptance criteria

- The deterministic provider emits `sha256-prefix-64`.
- Domain and PostgreSQL produce identical scores for each algorithm.
- A one-bit SHA-prefix difference scores zero.
- A one-bit perceptual-hash difference retains Hamming scoring.
- Existing deterministic rows are reclassified safely.
- Migration 030 participates in production validation and migration idempotency checks.
- The complete immutable CI pipeline remains green.

## Next slice

Expose durable Product Identification through authenticated API routes and the Android review interface, then connect a real allowlisted visual provider that can supply an actual perceptual fingerprint.
