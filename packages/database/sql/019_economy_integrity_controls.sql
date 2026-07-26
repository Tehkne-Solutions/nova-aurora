BEGIN;

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS asset_class text NOT NULL DEFAULT 'internal-consumable'
    CHECK (asset_class IN (
      'internal-consumable','internal-equity','collectible',
      'tokenized-collectible','regulated-instrument'
    )),
  ADD COLUMN IF NOT EXISTS external_transfer_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tokenization_status text NOT NULL DEFAULT 'not-tokenized'
    CHECK (tokenization_status IN ('not-tokenized','sandbox','review','enabled','suspended')),
  ADD COLUMN IF NOT EXISTS blockchain_network text,
  ADD COLUMN IF NOT EXISTS legal_classification text NOT NULL DEFAULT 'virtual-game-asset';

CREATE TABLE IF NOT EXISTS user_risk_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  risk_score integer NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 1000),
  risk_level text NOT NULL DEFAULT 'low'
    CHECK (risk_level IN ('low','medium','high','critical')),
  economic_status text NOT NULL DEFAULT 'normal'
    CHECK (economic_status IN ('normal','monitored','restricted','frozen')),
  review_reason text,
  last_evaluated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fraud_events (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  event_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','low','medium','high','critical')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','reviewing','resolved','false-positive')),
  score_delta integer NOT NULL DEFAULT 0,
  source text NOT NULL,
  resource_type text,
  resource_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS market_controls (
  item_id uuid PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','paused','tripped','maintenance')),
  reference_price_minor bigint,
  max_deviation_bps integer NOT NULL DEFAULT 2500
    CHECK (max_deviation_bps BETWEEN 100 AND 10000),
  max_order_gross_minor bigint NOT NULL DEFAULT 5000000 CHECK (max_order_gross_minor > 0),
  max_daily_gross_minor bigint NOT NULL DEFAULT 20000000 CHECK (max_daily_gross_minor > 0),
  max_open_orders integer NOT NULL DEFAULT 20 CHECK (max_open_orders > 0),
  max_orders_per_minute integer NOT NULL DEFAULT 12 CHECK (max_orders_per_minute > 0),
  cooldown_seconds integer NOT NULL DEFAULT 300 CHECK (cooldown_seconds >= 0),
  tripped_at timestamptz,
  trip_reason text,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_integrity_events (
  id uuid PRIMARY KEY,
  item_id uuid REFERENCES items(id),
  user_id uuid REFERENCES users(id),
  event_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','low','medium','high','critical')),
  action text NOT NULL CHECK (action IN ('allow','monitor','deny','pause','trip')),
  order_id uuid REFERENCES market_orders(id),
  trade_id uuid REFERENCES market_trades(id),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_control_change_requests (
  id uuid PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES items(id),
  proposed_by uuid NOT NULL REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  change_type text NOT NULL CHECK (change_type IN (
    'limits','pause','resume','reset-reference','asset-classification'
  )),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','approved','rejected','applied','cancelled')),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  applied_at timestamptz,
  CHECK (approved_by IS NULL OR approved_by<>proposed_by)
);

CREATE TABLE IF NOT EXISTS economic_limit_overrides (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  max_order_gross_minor bigint,
  max_daily_gross_minor bigint,
  max_open_orders integer,
  expires_at timestamptz,
  reason text NOT NULL,
  approved_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fraud_event_open_idx
  ON fraud_events(status,severity,created_at DESC);
CREATE INDEX IF NOT EXISTS market_integrity_item_time_idx
  ON market_integrity_events(item_id,created_at DESC);
CREATE INDEX IF NOT EXISTS market_orders_owner_time_idx
  ON market_orders(owner_id,created_at DESC);

INSERT INTO user_risk_profiles (user_id)
SELECT id FROM users
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO market_controls (item_id,reference_price_minor)
SELECT item.id,(
  SELECT history.unit_price_minor
  FROM market_price_history history
  WHERE history.item_id=item.id
  ORDER BY history.recorded_at DESC LIMIT 1
)
FROM items item
ON CONFLICT (item_id) DO NOTHING;

COMMIT;
