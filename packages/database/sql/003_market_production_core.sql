BEGIN;

ALTER TABLE market_orders
  ADD COLUMN IF NOT EXISTS filled_minor bigint NOT NULL DEFAULT 0 CHECK (filled_minor >= 0),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS market_order_id uuid REFERENCES market_orders(id),
  ADD COLUMN IF NOT EXISTS production_order_id uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS market_trades (
  id uuid PRIMARY KEY,
  buy_order_id uuid NOT NULL REFERENCES market_orders(id),
  sell_order_id uuid NOT NULL REFERENCES market_orders(id),
  item_id uuid NOT NULL REFERENCES items(id),
  buyer_id uuid NOT NULL REFERENCES users(id),
  seller_id uuid NOT NULL REFERENCES users(id),
  quantity_minor bigint NOT NULL CHECK (quantity_minor > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor > 0),
  gross_minor bigint NOT NULL CHECK (gross_minor > 0),
  tax_minor bigint NOT NULL CHECK (tax_minor >= 0),
  seller_net_minor bigint NOT NULL CHECK (seller_net_minor > 0),
  ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS production_recipes (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  output_item_id uuid NOT NULL REFERENCES items(id),
  output_quantity_minor bigint NOT NULL CHECK (output_quantity_minor > 0),
  duration_seconds integer NOT NULL CHECK (duration_seconds > 0),
  energy_cost_minor bigint NOT NULL DEFAULT 0 CHECK (energy_cost_minor >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS production_recipe_inputs (
  recipe_id uuid NOT NULL REFERENCES production_recipes(id),
  item_id uuid NOT NULL REFERENCES items(id),
  quantity_minor bigint NOT NULL CHECK (quantity_minor > 0),
  PRIMARY KEY (recipe_id, item_id)
);

CREATE TABLE IF NOT EXISTS production_orders (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  company_id uuid REFERENCES companies(id),
  recipe_id uuid NOT NULL REFERENCES production_recipes(id),
  batches integer NOT NULL CHECK (batches > 0),
  status text NOT NULL CHECK (status IN ('queued','processing','completed','cancelled','failed')),
  idempotency_key text NOT NULL UNIQUE,
  seed bigint NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  completes_at timestamptz NOT NULL,
  completed_at timestamptz,
  cancelled_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_production_order_fk'
  ) THEN
    ALTER TABLE reservations
      ADD CONSTRAINT reservations_production_order_fk
      FOREIGN KEY (production_order_id) REFERENCES production_orders(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS market_price_history (
  id bigserial PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES items(id),
  trade_id uuid NOT NULL UNIQUE REFERENCES market_trades(id),
  unit_price_minor bigint NOT NULL,
  quantity_minor bigint NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_match_sell_idx
  ON market_orders (item_id, unit_price_minor ASC, created_at ASC, id ASC)
  WHERE side='sell' AND status IN ('open','partial') AND remaining_minor > 0;
CREATE INDEX IF NOT EXISTS market_match_buy_idx
  ON market_orders (item_id, unit_price_minor DESC, created_at ASC, id ASC)
  WHERE side='buy' AND status IN ('open','partial') AND remaining_minor > 0;
CREATE INDEX IF NOT EXISTS reservations_market_idx
  ON reservations (market_order_id, status) WHERE market_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reservations_production_idx
  ON reservations (production_order_id, status) WHERE production_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS production_due_idx
  ON production_orders (completes_at, id) WHERE status='queued';
CREATE INDEX IF NOT EXISTS market_trades_item_time_idx
  ON market_trades (item_id, created_at DESC);

CREATE OR REPLACE VIEW ledger_account_balances AS
SELECT
  account.id AS account_id,
  account.code,
  account.owner_id,
  COALESCE(SUM(entry.amount_minor), 0)::bigint AS posted_minor,
  COALESCE((
    SELECT SUM(reservation.remaining_minor)
    FROM reservations reservation
    WHERE reservation.resource_type='balance'
      AND reservation.resource_id=account.id
      AND reservation.status='active'
      AND reservation.expires_at > now()
  ), 0)::bigint AS reserved_minor,
  (
    COALESCE(SUM(entry.amount_minor), 0)
    - COALESCE((
      SELECT SUM(reservation.remaining_minor)
      FROM reservations reservation
      WHERE reservation.resource_type='balance'
        AND reservation.resource_id=account.id
        AND reservation.status='active'
        AND reservation.expires_at > now()
    ), 0)
  )::bigint AS available_minor
FROM ledger_accounts account
LEFT JOIN ledger_entries entry ON entry.account_id=account.id
GROUP BY account.id;

INSERT INTO production_recipes (
  id, code, name, output_item_id, output_quantity_minor,
  duration_seconds, energy_cost_minor
) VALUES
  ('d0000000-0000-4000-8000-000000000001','flour','Moer farinha','b0000000-0000-4000-8000-000000000003',800,5,200),
  ('d0000000-0000-4000-8000-000000000002','bread','Assar pão','b0000000-0000-4000-8000-000000000004',1000,8,200)
ON CONFLICT (code) DO UPDATE SET
  name=EXCLUDED.name,
  output_item_id=EXCLUDED.output_item_id,
  output_quantity_minor=EXCLUDED.output_quantity_minor,
  duration_seconds=EXCLUDED.duration_seconds,
  energy_cost_minor=EXCLUDED.energy_cost_minor,
  active=true;

INSERT INTO production_recipe_inputs (recipe_id,item_id,quantity_minor) VALUES
  ('d0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002',400),
  ('d0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000003',300),
  ('d0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000001',100)
ON CONFLICT (recipe_id,item_id) DO UPDATE SET quantity_minor=EXCLUDED.quantity_minor;

INSERT INTO inventory_lots (id,owner_id,item_id,quantity_minor,reserved_minor,quality)
VALUES
  ('e0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000001',2000,0,60),
  ('e0000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000002',4000,0,60),
  ('e0000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000004',2000,0,60)
ON CONFLICT (id) DO NOTHING;

COMMIT;
