CREATE TABLE IF NOT EXISTS economy_anomaly_rebalance_approvals (
  id uuid PRIMARY KEY,
  anomaly_id uuid NOT NULL REFERENCES economy_snapshot_anomalies(id) ON DELETE CASCADE,
  recommendation text NOT NULL CHECK (recommendation IN ('assign_owner','rebalance_owner','assign_or_escalate','escalate_capacity')),
  requested_owner_id uuid NULL,
  requested_by uuid NOT NULL,
  request_reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','consumed')),
  decided_by uuid NULL,
  decision_reason text NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz NULL,
  consumed_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_economy_anomaly_rebalance_approvals_pending
  ON economy_anomaly_rebalance_approvals(status,requested_at,id)
  WHERE status='pending';

CREATE INDEX IF NOT EXISTS idx_economy_anomaly_rebalance_approvals_anomaly
  ON economy_anomaly_rebalance_approvals(anomaly_id,requested_at DESC,id DESC);
