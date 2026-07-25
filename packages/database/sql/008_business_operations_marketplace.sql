BEGIN;

CREATE TABLE IF NOT EXISTS business_catalog_entries (
  id uuid PRIMARY KEY,
  building_id uuid NOT NULL REFERENCES property_buildings(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  code text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  category text NOT NULL CHECK (category IN ('food','retail','services','creative','industrial')),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor > 0),
  capacity_per_cycle integer NOT NULL CHECK (capacity_per_cycle > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (building_id,code)
);

CREATE TABLE IF NOT EXISTS district_demand_profiles (
  district_id uuid NOT NULL REFERENCES city_districts(id),
  category text NOT NULL CHECK (category IN ('food','retail','services','creative','industrial')),
  base_visitors integer NOT NULL CHECK (base_visitors > 0),
  reference_price_minor bigint NOT NULL CHECK (reference_price_minor > 0),
  price_sensitivity numeric(6,3) NOT NULL DEFAULT 1.000 CHECK (price_sensitivity > 0),
  quality_weight numeric(6,3) NOT NULL DEFAULT 1.000 CHECK (quality_weight > 0),
  seasonality numeric(6,3) NOT NULL DEFAULT 1.000 CHECK (seasonality > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (district_id,category)
);

CREATE TABLE IF NOT EXISTS company_reputation (
  company_id uuid PRIMARY KEY REFERENCES companies(id),
  score integer NOT NULL DEFAULT 50 CHECK (score BETWEEN 0 AND 100),
  review_count integer NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_demand_cycles (
  id uuid PRIMARY KEY,
  catalog_entry_id uuid NOT NULL REFERENCES business_catalog_entries(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  building_id uuid NOT NULL REFERENCES property_buildings(id),
  visitors integer NOT NULL CHECK (visitors >= 0),
  customers integer NOT NULL CHECK (customers >= 0 AND customers <= visitors),
  gross_revenue_minor bigint NOT NULL CHECK (gross_revenue_minor >= 0),
  tax_minor bigint NOT NULL CHECK (tax_minor >= 0),
  satisfaction integer NOT NULL CHECK (satisfaction BETWEEN 0 AND 100),
  reputation_delta integer NOT NULL,
  ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_reviews (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id),
  building_id uuid NOT NULL REFERENCES property_buildings(id),
  reviewer_id uuid REFERENCES users(id),
  source text NOT NULL CHECK (source IN ('npc','player')),
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text NOT NULL,
  demand_cycle_id uuid REFERENCES business_demand_cycles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_job_openings (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id),
  building_id uuid REFERENCES property_buildings(id),
  role_code text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  wage_minor bigint NOT NULL CHECK (wage_minor > 0),
  slots integer NOT NULL CHECK (slots > 0),
  filled_slots integer NOT NULL DEFAULT 0 CHECK (filled_slots >= 0 AND filled_slots <= slots),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','filled','closed')),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS company_employments (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id),
  opening_id uuid NOT NULL REFERENCES company_job_openings(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role_code text NOT NULL,
  wage_minor bigint NOT NULL CHECK (wage_minor > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS company_employment_active_user_idx
  ON company_employments(company_id,user_id)
  WHERE status='active';

CREATE TABLE IF NOT EXISTS company_payroll_runs (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id),
  total_wages_minor bigint NOT NULL CHECK (total_wages_minor >= 0),
  payroll_tax_minor bigint NOT NULL CHECK (payroll_tax_minor >= 0),
  employee_count integer NOT NULL CHECK (employee_count >= 0),
  ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_payroll_payments (
  payroll_run_id uuid NOT NULL REFERENCES company_payroll_runs(id),
  employment_id uuid NOT NULL REFERENCES company_employments(id),
  user_id uuid NOT NULL REFERENCES users(id),
  wage_minor bigint NOT NULL CHECK (wage_minor > 0),
  PRIMARY KEY (payroll_run_id,employment_id)
);

CREATE TABLE IF NOT EXISTS company_share_market_listings (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id),
  seller_id uuid NOT NULL REFERENCES users(id),
  units_total integer NOT NULL CHECK (units_total > 0),
  units_remaining integer NOT NULL CHECK (units_remaining >= 0 AND units_remaining <= units_total),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','filled','cancelled')),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS company_share_market_trades (
  id uuid PRIMARY KEY,
  listing_id uuid NOT NULL REFERENCES company_share_market_listings(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  seller_id uuid NOT NULL REFERENCES users(id),
  buyer_id uuid NOT NULL REFERENCES users(id),
  units integer NOT NULL CHECK (units > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor > 0),
  gross_minor bigint NOT NULL CHECK (gross_minor > 0),
  ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_company_status_idx
  ON business_catalog_entries(company_id,status);
CREATE INDEX IF NOT EXISTS demand_cycle_company_time_idx
  ON business_demand_cycles(company_id,created_at DESC);
CREATE INDEX IF NOT EXISTS job_opening_company_status_idx
  ON company_job_openings(company_id,status);
CREATE INDEX IF NOT EXISTS employment_company_status_idx
  ON company_employments(company_id,status);
CREATE INDEX IF NOT EXISTS share_market_open_idx
  ON company_share_market_listings(company_id,unit_price_minor,created_at)
  WHERE status='open';

INSERT INTO company_reputation (company_id,score,review_count)
SELECT id,50,0 FROM companies
ON CONFLICT (company_id) DO NOTHING;

INSERT INTO district_demand_profiles (
  district_id,category,base_visitors,reference_price_minor,
  price_sensitivity,quality_weight,seasonality
) VALUES
  ('f1000000-0000-4000-8000-000000000001','food',42,2200,1.150,1.000,1.050),
  ('f1000000-0000-4000-8000-000000000001','retail',34,3000,1.100,0.950,1.000),
  ('f1000000-0000-4000-8000-000000000001','services',30,4500,0.950,1.100,1.000),
  ('f1000000-0000-4000-8000-000000000002','industrial',28,6000,0.800,1.150,1.100),
  ('f1000000-0000-4000-8000-000000000002','services',24,5000,0.850,1.050,1.000),
  ('f1000000-0000-4000-8000-000000000003','food',36,1800,1.000,1.100,1.150),
  ('f1000000-0000-4000-8000-000000000003','retail',22,2500,0.950,1.000,1.050),
  ('f1000000-0000-4000-8000-000000000004','creative',40,5500,0.850,1.250,1.100),
  ('f1000000-0000-4000-8000-000000000004','services',32,4800,0.900,1.200,1.050)
ON CONFLICT (district_id,category) DO UPDATE SET
  base_visitors=EXCLUDED.base_visitors,
  reference_price_minor=EXCLUDED.reference_price_minor,
  price_sensitivity=EXCLUDED.price_sensitivity,
  quality_weight=EXCLUDED.quality_weight,
  seasonality=EXCLUDED.seasonality,
  updated_at=now();

COMMIT;
