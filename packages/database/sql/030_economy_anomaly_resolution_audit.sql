BEGIN;

ALTER TABLE economy_snapshot_anomalies
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS resolution_reason text;

ALTER TABLE economy_snapshot_anomalies
  DROP CONSTRAINT IF EXISTS economy_snapshot_anomalies_resolution_consistency;

ALTER TABLE economy_snapshot_anomalies
  ADD CONSTRAINT economy_snapshot_anomalies_resolution_consistency CHECK (
    (resolved_at IS NULL AND resolved_by IS NULL AND resolution_reason IS NULL)
    OR
    (resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_reason IS NOT NULL AND length(trim(resolution_reason)) >= 10)
  );

CREATE INDEX IF NOT EXISTS economy_snapshot_anomalies_resolution_idx
  ON economy_snapshot_anomalies(resolved_at, severity, detected_at DESC);

COMMIT;
