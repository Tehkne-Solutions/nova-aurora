BEGIN;

CREATE TABLE IF NOT EXISTS economy_indicator_catalog (
  indicator_key text PRIMARY KEY,
  label text NOT NULL,
  description text NOT NULL,
  unit text NOT NULL CHECK (unit IN ('minor','quantity','percent','ratio','index','count')),
  aggregation text NOT NULL CHECK (aggregation IN ('sum','average','last','derived')),
  minimum_value numeric,
  maximum_value numeric,
  is_required boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO economy_indicator_catalog(indicator_key,label,description,unit,aggregation,minimum_value,maximum_value)
VALUES
  ('money-supply','Estoque monetário','Saldo monetário reconciliado no escopo.','minor','sum',0,NULL),
  ('transaction-volume','Volume transacionado','Volume bruto liquidado durante a janela.','minor','sum',0,NULL),
  ('money-velocity','Velocidade monetária','Razão entre volume transacionado e estoque monetário médio.','ratio','derived',0,NULL),
  ('price-index','Índice de preços','Índice ponderado de preços observados, base 100.','index','derived',0,NULL),
  ('inflation-rate','Inflação da janela','Variação percentual do índice de preços contra a janela anterior.','percent','derived',NULL,NULL),
  ('production-output','Produção agregada','Quantidade produzida durante a janela.','quantity','sum',0,NULL),
  ('consumption-output','Consumo agregado','Quantidade consumida durante a janela.','quantity','sum',0,NULL),
  ('employment-rate','Taxa de ocupação','Percentual da população economicamente ativa ocupada.','percent','derived',0,100),
  ('wealth-concentration','Concentração econômica','Participação do maior decil no estoque monetário observado.','percent','derived',0,100),
  ('fiscal-balance','Saldo fiscal','Receitas públicas menos despesas públicas na janela.','minor','derived',NULL,NULL)
ON CONFLICT(indicator_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS economy_snapshots (
  id uuid PRIMARY KEY,
  scope_type text NOT NULL CHECK (scope_type IN ('city','region','platform')),
  scope_id uuid,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'computed' CHECK (status IN ('computed','reconciled','divergent','superseded')),
  ledger_cutoff timestamptz NOT NULL,
  money_supply_minor bigint NOT NULL CHECK (money_supply_minor >= 0),
  transaction_volume_minor bigint NOT NULL CHECK (transaction_volume_minor >= 0),
  money_velocity numeric(18,8) NOT NULL CHECK (money_velocity >= 0),
  price_index numeric(18,8),
  inflation_rate_percent numeric(18,8),
  production jsonb NOT NULL DEFAULT '{}'::jsonb,
  consumption jsonb NOT NULL DEFAULT '{}'::jsonb,
  employment_rate_percent numeric(9,6),
  wealth_concentration_percent numeric(9,6),
  fiscal_balance_minor bigint NOT NULL DEFAULT 0,
  indicators jsonb NOT NULL DEFAULT '{}'::jsonb,
  assumptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_hash text NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  reconciled_at timestamptz,
  CHECK (window_end > window_start),
  CHECK ((scope_type='platform' AND scope_id IS NULL) OR (scope_type<>'platform' AND scope_id IS NOT NULL)),
  UNIQUE(scope_type,scope_id,window_start,window_end,source_hash)
);

CREATE INDEX IF NOT EXISTS economy_snapshots_scope_window_idx
  ON economy_snapshots(scope_type,scope_id,window_end DESC);
CREATE INDEX IF NOT EXISTS economy_snapshots_status_idx
  ON economy_snapshots(status,computed_at DESC);

CREATE TABLE IF NOT EXISTS economy_snapshot_reconciliations (
  id uuid PRIMARY KEY,
  snapshot_id uuid NOT NULL REFERENCES economy_snapshots(id) ON DELETE RESTRICT,
  ledger_total_minor bigint NOT NULL,
  snapshot_total_minor bigint NOT NULL,
  difference_minor bigint NOT NULL,
  tolerance_minor bigint NOT NULL DEFAULT 0 CHECK (tolerance_minor >= 0),
  is_balanced boolean NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  reconciled_by uuid REFERENCES users(id),
  reconciled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(snapshot_id)
);

CREATE TABLE IF NOT EXISTS economy_snapshot_anomalies (
  id uuid PRIMARY KEY,
  snapshot_id uuid NOT NULL REFERENCES economy_snapshots(id) ON DELETE RESTRICT,
  anomaly_key text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  metric_key text NOT NULL,
  observed_value numeric,
  expected_min numeric,
  expected_max numeric,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE(snapshot_id,anomaly_key)
);

COMMIT;
