ALTER TABLE economy_snapshot_anomalies
  ADD COLUMN assigned_to uuid REFERENCES users(id),
  ADD COLUMN assigned_at timestamptz,
  ADD COLUMN assigned_by uuid REFERENCES users(id),
  ADD COLUMN acknowledged_at timestamptz,
  ADD COLUMN acknowledged_by uuid REFERENCES users(id);

CREATE TABLE economy_anomaly_ownership_events (
  id uuid PRIMARY KEY,
  anomaly_id uuid NOT NULL REFERENCES economy_snapshot_anomalies(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('assigned','reassigned','unassigned','acknowledged')),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  subject_user_id uuid REFERENCES users(id),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 1000),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX economy_anomaly_ownership_events_anomaly_time_idx
  ON economy_anomaly_ownership_events(anomaly_id,occurred_at DESC,id DESC);

CREATE INDEX economy_snapshot_anomalies_open_owner_idx
  ON economy_snapshot_anomalies(assigned_to,severity,detected_at)
  WHERE resolved_at IS NULL;

-- Tehkné Solutions
