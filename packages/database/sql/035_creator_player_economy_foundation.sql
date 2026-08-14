-- Creator & Player Economy foundation
-- Tehkné Solutions

CREATE TABLE IF NOT EXISTS economy_ad_surfaces (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id),
  surface_kind text NOT NULL CHECK (surface_kind IN ('profile','store','page','venue','arena','event')),
  surface_ref text NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  format text NOT NULL CHECK (format IN ('banner','tile','billboard','video','audio','native')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','retired')),
  moderation_status text NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending','approved','rejected')),
  revenue_share_bps integer NOT NULL DEFAULT 7000 CHECK (revenue_share_bps BETWEEN 0 AND 10000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id, surface_kind, surface_ref, format)
);

CREATE INDEX IF NOT EXISTS economy_ad_surfaces_owner_idx
  ON economy_ad_surfaces(owner_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS economy_ad_campaigns (
  id uuid PRIMARY KEY,
  advertiser_user_id uuid REFERENCES users(id),
  advertiser_name text NOT NULL CHECK (length(advertiser_name) BETWEEN 1 AND 180),
  campaign_kind text NOT NULL CHECK (campaign_kind IN ('internal','external')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 180),
  creative_type text NOT NULL CHECK (creative_type IN ('image','video','audio','native')),
  creative_uri text NOT NULL,
  destination_uri text,
  pricing_model text NOT NULL DEFAULT 'flat' CHECK (pricing_model IN ('flat','cpm','cpc')),
  budget_minor bigint NOT NULL DEFAULT 0 CHECK (budget_minor >= 0),
  bid_minor bigint NOT NULL DEFAULT 0 CHECK (bid_minor >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','active','paused','ended','rejected')),
  starts_at timestamptz,
  ends_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (campaign_kind <> 'internal' OR advertiser_user_id IS NOT NULL),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS economy_ad_campaigns_advertiser_idx
  ON economy_ad_campaigns(advertiser_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS economy_ad_placements (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES economy_ad_campaigns(id) ON DELETE CASCADE,
  surface_id uuid NOT NULL REFERENCES economy_ad_surfaces(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','active','paused','ended','rejected')),
  agreed_rate_minor bigint NOT NULL DEFAULT 0 CHECK (agreed_rate_minor >= 0),
  publisher_share_bps integer NOT NULL DEFAULT 7000 CHECK (publisher_share_bps BETWEEN 0 AND 10000),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, surface_id),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS economy_ad_placements_surface_idx
  ON economy_ad_placements(surface_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS creator_channels (
  id uuid PRIMARY KEY,
  creator_user_id uuid NOT NULL REFERENCES users(id),
  handle text NOT NULL UNIQUE CHECK (handle ~ '^[a-z0-9][a-z0-9._-]{2,39}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','retired')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creator_channels_creator_idx
  ON creator_channels(creator_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS creator_content (
  id uuid PRIMARY KEY,
  channel_id uuid NOT NULL REFERENCES creator_channels(id) ON DELETE CASCADE,
  creator_user_id uuid NOT NULL REFERENCES users(id),
  content_type text NOT NULL CHECK (content_type IN ('post','video','audio','live','magazine','course','gallery','event')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 180),
  body text NOT NULL DEFAULT '',
  media_uri text,
  access_model text NOT NULL DEFAULT 'free' CHECK (access_model IN ('free','purchase','subscription','ticket')),
  price_minor bigint NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived','rejected')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (access_model = 'free' OR price_minor > 0)
);

CREATE INDEX IF NOT EXISTS creator_content_channel_idx
  ON creator_content(channel_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS creator_content_creator_idx
  ON creator_content(creator_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS ugc_object_blueprints (
  id uuid PRIMARY KEY,
  creator_user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  category text NOT NULL CHECK (category IN ('decor','furniture','wearable','art','collectible','architecture','vehicle','component')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  asset_manifest_uri text NOT NULL,
  content_hash text NOT NULL CHECK (length(content_hash) BETWEEN 16 AND 256),
  royalty_bps integer NOT NULL DEFAULT 500 CHECK (royalty_bps BETWEEN 0 AND 5000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired','rejected')),
  tokenization_status text NOT NULL DEFAULT 'disabled' CHECK (tokenization_status IN ('disabled','eligible','anchored')),
  external_token_ref text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_user_id, name, version),
  UNIQUE(content_hash),
  CHECK (tokenization_status = 'anchored' OR external_token_ref IS NULL)
);

CREATE INDEX IF NOT EXISTS ugc_object_blueprints_creator_idx
  ON ugc_object_blueprints(creator_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS ugc_object_editions (
  id uuid PRIMARY KEY,
  blueprint_id uuid NOT NULL REFERENCES ugc_object_blueprints(id) ON DELETE CASCADE,
  edition_name text NOT NULL CHECK (length(edition_name) BETWEEN 1 AND 120),
  scarcity text NOT NULL DEFAULT 'open' CHECK (scarcity IN ('open','limited','unique')),
  supply_cap integer CHECK (supply_cap IS NULL OR supply_cap > 0),
  minted_count integer NOT NULL DEFAULT 0 CHECK (minted_count >= 0),
  unit_price_minor bigint NOT NULL DEFAULT 0 CHECK (unit_price_minor >= 0),
  transferable boolean NOT NULL DEFAULT true,
  resale_allowed boolean NOT NULL DEFAULT true,
  tokenization_eligible boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(blueprint_id, edition_name),
  CHECK (scarcity = 'open' OR supply_cap IS NOT NULL),
  CHECK (scarcity <> 'unique' OR supply_cap = 1),
  CHECK (supply_cap IS NULL OR minted_count <= supply_cap)
);

CREATE TABLE IF NOT EXISTS ugc_object_instances (
  id uuid PRIMARY KEY,
  edition_id uuid NOT NULL REFERENCES ugc_object_editions(id),
  serial_number integer NOT NULL CHECK (serial_number > 0),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  origin_creator_user_id uuid NOT NULL REFERENCES users(id),
  provenance_hash text NOT NULL CHECK (length(provenance_hash) BETWEEN 16 AND 256),
  external_token_ref text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','locked','burned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(edition_id, serial_number),
  UNIQUE(provenance_hash)
);

CREATE INDEX IF NOT EXISTS ugc_object_instances_owner_idx
  ON ugc_object_instances(owner_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS player_competitions (
  id uuid PRIMARY KEY,
  organizer_user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 180),
  competition_type text NOT NULL CHECK (competition_type IN ('game','quiz','race','creative','tournament')),
  outcome_mode text NOT NULL DEFAULT 'skill_ranked' CHECK (outcome_mode = 'skill_ranked'),
  entry_mode text NOT NULL DEFAULT 'free' CHECK (entry_mode IN ('free','virtual_entry_fee')),
  entry_fee_minor bigint NOT NULL DEFAULT 0 CHECK (entry_fee_minor >= 0),
  sponsor_pool_minor bigint NOT NULL DEFAULT 0 CHECK (sponsor_pool_minor >= 0),
  real_money_wagering boolean NOT NULL DEFAULT false CHECK (real_money_wagering = false),
  max_players integer CHECK (max_players IS NULL OR max_players > 1),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','running','settled','cancelled')),
  rules_uri text NOT NULL,
  starts_at timestamptz,
  ends_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((entry_mode = 'free' AND entry_fee_minor = 0) OR (entry_mode = 'virtual_entry_fee' AND entry_fee_minor > 0)),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS player_competitions_status_idx
  ON player_competitions(status, starts_at, created_at DESC);

CREATE TABLE IF NOT EXISTS player_competition_entries (
  competition_id uuid NOT NULL REFERENCES player_competitions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  paid_entry_minor bigint NOT NULL DEFAULT 0 CHECK (paid_entry_minor >= 0),
  score numeric,
  final_rank integer CHECK (final_rank IS NULL OR final_rank > 0),
  prize_minor bigint NOT NULL DEFAULT 0 CHECK (prize_minor >= 0),
  status text NOT NULL DEFAULT 'joined' CHECK (status IN ('joined','active','disqualified','settled')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(competition_id, user_id)
);
