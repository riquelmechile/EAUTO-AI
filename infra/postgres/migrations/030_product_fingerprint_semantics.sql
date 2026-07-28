BEGIN;

ALTER TABLE product_identification_results
  DROP CONSTRAINT IF EXISTS product_identification_results_fingerprint_algorithm_check;

ALTER TABLE product_visual_fingerprints
  DROP CONSTRAINT IF EXISTS product_visual_fingerprints_algorithm_check;

UPDATE product_identification_results
SET fingerprint_algorithm = 'sha256-prefix-64'
WHERE fingerprint_algorithm = 'phash-64'
  AND fingerprint_version = 'deterministic-sha256-prefix-v1';

UPDATE product_visual_fingerprints
SET algorithm = 'sha256-prefix-64'
WHERE algorithm = 'phash-64'
  AND version = 'deterministic-sha256-prefix-v1';

ALTER TABLE product_identification_results
  ADD CONSTRAINT product_identification_results_fingerprint_algorithm_check
  CHECK (fingerprint_algorithm IN ('phash-64', 'sha256-prefix-64'));

ALTER TABLE product_visual_fingerprints
  ADD CONSTRAINT product_visual_fingerprints_algorithm_check
  CHECK (algorithm IN ('phash-64', 'sha256-prefix-64'));

COMMIT;
