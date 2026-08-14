BEGIN;

ALTER TABLE economy_ad_campaigns
  ADD COLUMN IF NOT EXISTS spent_minor bigint NOT NULL DEFAULT 0 CHECK (spent_minor >= 0);

CREATE TABLE IF NOT EXISTS economy_ad_settlements (
  id uuid PRIMARY KEY,
  placement_id uuid NOT NULL REFERENCES economy_ad_placements(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES economy_ad_campaigns(id) ON DELETE RESTRICT,
  advertiser_user_id uuid NOT NULL REFERENCES users(id),
  publisher_user_id uuid NOT NULL REFERENCES users(id),
  gross_minor bigint NOT NULL CHECK (gross_minor > 0),
  publisher_minor bigint NOT NULL CHECK (publisher_minor >= 0),
  platform_minor bigint NOT NULL CHECK (platform_minor >= 0),
  ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
  idempotency_key text NOT NULL UNIQUE,
  settled_at timestamptz NOT NULL DEFAULT now(),
  CHECK (publisher_minor + platform_minor = gross_minor)
);

CREATE INDEX IF NOT EXISTS economy_ad_settlements_campaign_idx
  ON economy_ad_settlements(campaign_id, settled_at DESC);
CREATE INDEX IF NOT EXISTS economy_ad_settlements_publisher_idx
  ON economy_ad_settlements(publisher_user_id, settled_at DESC);

CREATE TABLE IF NOT EXISTS creator_content_purchases (
  id uuid PRIMARY KEY,
  content_id uuid NOT NULL REFERENCES creator_content(id) ON DELETE RESTRICT,
  buyer_user_id uuid NOT NULL REFERENCES users(id),
  creator_user_id uuid NOT NULL REFERENCES users(id),
  gross_minor bigint NOT NULL CHECK (gross_minor > 0),
  platform_fee_minor bigint NOT NULL CHECK (platform_fee_minor >= 0),
  creator_net_minor bigint NOT NULL CHECK (creator_net_minor >= 0),
  ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
  idempotency_key text NOT NULL UNIQUE,
  purchased_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(content_id, buyer_user_id),
  CHECK (platform_fee_minor + creator_net_minor = gross_minor)
);

CREATE INDEX IF NOT EXISTS creator_content_purchases_creator_idx
  ON creator_content_purchases(creator_user_id, purchased_at DESC);
CREATE INDEX IF NOT EXISTS creator_content_purchases_buyer_idx
  ON creator_content_purchases(buyer_user_id, purchased_at DESC);

CREATE TABLE IF NOT EXISTS ugc_primary_sales (
  id uuid PRIMARY KEY,
  edition_id uuid NOT NULL REFERENCES ugc_object_editions(id) ON DELETE RESTRICT,
  blueprint_id uuid NOT NULL REFERENCES ugc_object_blueprints(id) ON DELETE RESTRICT,
  instance_id uuid NOT NULL UNIQUE REFERENCES ugc_object_instances(id) ON DELETE RESTRICT,
  buyer_user_id uuid NOT NULL REFERENCES users(id),
  creator_user_id uuid NOT NULL REFERENCES users(id),
  gross_minor bigint NOT NULL CHECK (gross_minor > 0),
  platform_fee_minor bigint NOT NULL CHECK (platform_fee_minor >= 0),
  creator_net_minor bigint NOT NULL CHECK (creator_net_minor >= 0),
  ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
  idempotency_key text NOT NULL UNIQUE,
  sold_at timestamptz NOT NULL DEFAULT now(),
  CHECK (platform_fee_minor + creator_net_minor = gross_minor)
);

CREATE TABLE IF NOT EXISTS ugc_market_listings (
  id uuid PRIMARY KEY,
  instance_id uuid NOT NULL REFERENCES ugc_object_instances(id) ON DELETE RESTRICT,
  seller_user_id uuid NOT NULL REFERENCES users(id),
  price_minor bigint NOT NULL CHECK (price_minor > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','sold','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS ugc_market_listings_active_instance_uidx
  ON ugc_market_listings(instance_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS ugc_market_listings_active_idx
  ON ugc_market_listings(status, created_at DESC);

CREATE TABLE IF NOT EXISTS ugc_market_trades (
  id uuid PRIMARY KEY,
  listing_id uuid NOT NULL UNIQUE REFERENCES ugc_market_listings(id) ON DELETE RESTRICT,
  instance_id uuid NOT NULL REFERENCES ugc_object_instances(id) ON DELETE RESTRICT,
  buyer_user_id uuid NOT NULL REFERENCES users(id),
  seller_user_id uuid NOT NULL REFERENCES users(id),
  creator_user_id uuid NOT NULL REFERENCES users(id),
  gross_minor bigint NOT NULL CHECK (gross_minor > 0),
  royalty_minor bigint NOT NULL CHECK (royalty_minor >= 0),
  platform_fee_minor bigint NOT NULL CHECK (platform_fee_minor >= 0),
  seller_net_minor bigint NOT NULL CHECK (seller_net_minor >= 0),
  ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
  idempotency_key text NOT NULL UNIQUE,
  traded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (royalty_minor + platform_fee_minor + seller_net_minor = gross_minor)
);

ALTER TABLE player_competitions
  ADD COLUMN IF NOT EXISTS entry_pool_minor bigint NOT NULL DEFAULT 0 CHECK (entry_pool_minor >= 0),
  ADD COLUMN IF NOT EXISTS sponsor_funded_minor bigint NOT NULL DEFAULT 0 CHECK (sponsor_funded_minor >= 0),
  ADD COLUMN IF NOT EXISTS prize_paid_minor bigint NOT NULL DEFAULT 0 CHECK (prize_paid_minor >= 0);

CREATE TABLE IF NOT EXISTS player_competition_finance_events (
  id uuid PRIMARY KEY,
  competition_id uuid NOT NULL REFERENCES player_competitions(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('entry_fee','sponsor_funding','prize_payout','refund')),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  beneficiary_user_id uuid REFERENCES users(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
  idempotency_key text NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_competition_finance_events_competition_idx
  ON player_competition_finance_events(competition_id, occurred_at DESC);

COMMIT;

-- Tehkné Solutions
