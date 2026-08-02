CREATE TABLE economy_anomaly_rebalance_executions (
  id uuid PRIMARY KEY,
  anomaly_id uuid NOT NULL REFERENCES economy_snapshot_anomalies(id) ON DELETE CASCADE,
  previous_owner_id uuid REFERENCES users(id),
  next_owner_id uuid REFERENCES users(id),
  recommendation text NOT NULL CHECK (recommendation IN ('assign_owner','rebalance_owner','assign_or_escalate','escalate_capacity')),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 1000),
  idempotency_key text NOT NULL,
  executed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_user_id,idempotency_key)
);

CREATE INDEX economy_anomaly_rebalance_execution_anomaly_time_idx
  ON economy_anomaly_rebalance_executions(anomaly_id,executed_at DESC,id DESC);

-- Tehkné Solutions
