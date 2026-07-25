BEGIN;

CREATE TABLE IF NOT EXISTS business_stock_levels (
  building_id uuid NOT NULL REFERENCES property_buildings(id),
  catalog_entry_id uuid NOT NULL REFERENCES business_catalog_entries(id),
  quantity_units integer NOT NULL DEFAULT 0 CHECK (quantity_units >= 0),
  reorder_point integer NOT NULL DEFAULT 5 CHECK (reorder_point >= 0),
  average_unit_cost_minor bigint NOT NULL DEFAULT 0 CHECK (average_unit_cost_minor >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (building_id,catalog_entry_id)
);

CREATE TABLE IF NOT EXISTS supplier_offers (
  id uuid PRIMARY KEY,
  supplier_company_id uuid NOT NULL REFERENCES companies(id),
  item_code text NOT NULL,
  title text NOT NULL,
  category text NOT NULL CHECK (category IN ('food','retail','services','creative','industrial')),
  unit_cost_minor bigint NOT NULL CHECK (unit_cost_minor > 0),
  minimum_quantity integer NOT NULL DEFAULT 1 CHECK (minimum_quantity > 0),
  available_quantity integer NOT NULL CHECK (available_quantity >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','filled','cancelled')),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS business_b2b_contracts (
  id uuid PRIMARY KEY,
  buyer_company_id uuid NOT NULL REFERENCES companies(id),
  supplier_company_id uuid NOT NULL REFERENCES companies(id),
  buyer_building_id uuid NOT NULL REFERENCES property_buildings(id),
  buyer_catalog_entry_id uuid NOT NULL REFERENCES business_catalog_entries(id),
  supplier_offer_id uuid NOT NULL REFERENCES supplier_offers(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_cost_minor bigint NOT NULL CHECK (unit_cost_minor > 0),
  gross_minor bigint NOT NULL CHECK (gross_minor > 0),
  status text NOT NULL DEFAULT 'settled' CHECK (status IN ('settled','cancelled')),
  ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id),
  building_id uuid NOT NULL REFERENCES property_buildings(id),
  name text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('local','social','outdoor','influencer')),
  budget_minor bigint NOT NULL CHECK (budget_minor > 0),
  visitor_boost_pct integer NOT NULL CHECK (visitor_boost_pct BETWEEN 1 AND 100),
  conversions integer NOT NULL DEFAULT 0 CHECK (conversions >= 0),
  attributed_revenue_minor bigint NOT NULL DEFAULT 0 CHECK (attributed_revenue_minor >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_goals (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id),
  metric text NOT NULL CHECK (metric IN (
    'revenue','customers','reputation','stock','employee_satisfaction'
  )),
  title text NOT NULL,
  target_value bigint NOT NULL CHECK (target_value > 0),
  current_value bigint NOT NULL DEFAULT 0 CHECK (current_value >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','expired','cancelled')),
  deadline_at timestamptz NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS employee_management_profiles (
  employment_id uuid PRIMARY KEY REFERENCES company_employments(id),
  productivity_score integer NOT NULL DEFAULT 100 CHECK (productivity_score BETWEEN 40 AND 200),
  satisfaction_score integer NOT NULL DEFAULT 70 CHECK (satisfaction_score BETWEEN 0 AND 100),
  training_level integer NOT NULL DEFAULT 0 CHECK (training_level BETWEEN 0 AND 20),
  last_trained_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employee_training_runs (
  id uuid PRIMARY KEY,
  employment_id uuid NOT NULL REFERENCES company_employments(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  focus text NOT NULL CHECK (focus IN ('service','quality','productivity')),
  cost_minor bigint NOT NULL CHECK (cost_minor > 0),
  productivity_delta integer NOT NULL,
  satisfaction_delta integer NOT NULL,
  ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS district_business_metrics (
  district_id uuid NOT NULL REFERENCES city_districts(id),
  metric_date date NOT NULL DEFAULT current_date,
  visitors integer NOT NULL DEFAULT 0 CHECK (visitors >= 0),
  customers integer NOT NULL DEFAULT 0 CHECK (customers >= 0),
  gross_revenue_minor bigint NOT NULL DEFAULT 0 CHECK (gross_revenue_minor >= 0),
  active_employees integer NOT NULL DEFAULT 0 CHECK (active_employees >= 0),
  average_reputation numeric(7,2) NOT NULL DEFAULT 0 CHECK (average_reputation >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (district_id,metric_date)
);

CREATE TABLE IF NOT EXISTS business_alerts (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id),
  building_id uuid REFERENCES property_buildings(id),
  code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS business_alert_open_code_idx
  ON business_alerts(company_id,code)
  WHERE status='open';

CREATE INDEX IF NOT EXISTS supplier_offer_open_idx
  ON supplier_offers(category,unit_cost_minor,created_at)
  WHERE status='open';

CREATE INDEX IF NOT EXISTS b2b_contract_company_idx
  ON business_b2b_contracts(buyer_company_id,supplier_company_id,created_at DESC);

CREATE INDEX IF NOT EXISTS campaign_company_active_idx
  ON marketing_campaigns(company_id,ends_at)
  WHERE status='active';

CREATE INDEX IF NOT EXISTS company_goal_active_idx
  ON company_goals(company_id,deadline_at)
  WHERE status='active';

CREATE INDEX IF NOT EXISTS district_metric_recent_idx
  ON district_business_metrics(metric_date DESC,district_id);

INSERT INTO employee_management_profiles (employment_id)
SELECT id FROM company_employments
ON CONFLICT (employment_id) DO NOTHING;

COMMIT;
