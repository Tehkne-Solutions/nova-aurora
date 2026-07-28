CREATE TABLE economy_anomaly_actions (
  id uuid PRIMARY KEY,
  anomaly_id uuid NOT NULL REFERENCES economy_snapshot_anomalies(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES economy_snapshots(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('resolved','reopened')),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 1000),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX economy_anomaly_actions_anomaly_time_idx
  ON economy_anomaly_actions(anomaly_id,occurred_at DESC,id DESC);

CREATE OR REPLACE FUNCTION record_economy_anomaly_resolution_action()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.resolved_at IS NULL AND NEW.resolved_at IS NOT NULL THEN
    INSERT INTO economy_anomaly_actions(id,anomaly_id,snapshot_id,action,actor_user_id,reason)
    VALUES(gen_random_uuid(),NEW.id,NEW.snapshot_id,'resolved',NEW.resolved_by,NEW.resolution_reason);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER economy_anomaly_resolution_action_trigger
AFTER UPDATE OF resolved_at ON economy_snapshot_anomalies
FOR EACH ROW
EXECUTE FUNCTION record_economy_anomaly_resolution_action();

-- Tehkné Solutions
