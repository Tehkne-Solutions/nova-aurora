BEGIN;

ALTER TABLE beta_experiment_decisions
  DROP CONSTRAINT IF EXISTS beta_experiment_decisions_decision_check;
ALTER TABLE beta_experiment_decisions
  ADD CONSTRAINT beta_experiment_decisions_decision_check
  CHECK (decision IN ('expand','hold','reduce','stop','reject'));

CREATE TABLE IF NOT EXISTS beta_experiment_reports (
  id uuid PRIMARY KEY,
  experiment_id uuid NOT NULL UNIQUE REFERENCES beta_experiments(id) ON DELETE CASCADE,
  report_key text NOT NULL UNIQUE,
  decision_id uuid NOT NULL REFERENCES beta_experiment_decisions(id) ON DELETE RESTRICT,
  summary jsonb NOT NULL,
  learning text NOT NULL,
  future_recommendations text[] NOT NULL DEFAULT '{}'::text[],
  audit_hash text NOT NULL,
  generated_by uuid NOT NULL REFERENCES users(id),
  generated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS beta_experiment_reports_generated_idx
  ON beta_experiment_reports(generated_at DESC);

COMMIT;
