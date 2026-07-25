CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  owner_id uuid REFERENCES users(id),
  account_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ledger_transactions (
  id uuid PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  transaction_type text NOT NULL,
  status text NOT NULL DEFAULT 'posted',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
  account_id uuid NOT NULL REFERENCES ledger_accounts(id),
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
  memo text NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  base_price_minor bigint NOT NULL CHECK (base_price_minor >= 0)
);
CREATE TABLE IF NOT EXISTS inventory_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  item_id uuid NOT NULL REFERENCES items(id),
  quantity_minor bigint NOT NULL CHECK (quantity_minor >= 0),
  reserved_minor bigint NOT NULL DEFAULT 0 CHECK (reserved_minor BETWEEN 0 AND quantity_minor),
  quality smallint NOT NULL DEFAULT 60 CHECK (quality BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS market_orders (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  side text NOT NULL CHECK (side IN ('buy','sell')),
  item_id uuid NOT NULL REFERENCES items(id),
  quantity_minor bigint NOT NULL CHECK (quantity_minor > 0),
  remaining_minor bigint NOT NULL CHECK (remaining_minor >= 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor > 0),
  status text NOT NULL DEFAULT 'open',
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reservations (
  id uuid PRIMARY KEY,
  resource_type text NOT NULL CHECK (resource_type IN ('balance','inventory')),
  resource_id uuid NOT NULL,
  quantity_minor bigint NOT NULL CHECK (quantity_minor > 0),
  remaining_minor bigint NOT NULL CHECK (remaining_minor >= 0),
  status text NOT NULL CHECK (status IN ('active','captured','released','expired')),
  expires_at timestamptz NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY,
  event_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE TABLE IF NOT EXISTS idempotency_records (
  key text PRIMARY KEY,
  actor_id uuid,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS open_orders_idx ON market_orders (item_id, side, unit_price_minor, created_at) WHERE status='open';
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox_events (occurred_at) WHERE published_at IS NULL;

CREATE OR REPLACE FUNCTION assert_balanced(target uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE total bigint;
BEGIN
  SELECT COALESCE(SUM(amount_minor),0) INTO total FROM ledger_entries WHERE transaction_id=target;
  IF total <> 0 THEN RAISE EXCEPTION 'unbalanced transaction %: %', target, total; END IF;
END $$;
