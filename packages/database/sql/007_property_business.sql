BEGIN;

CREATE TABLE IF NOT EXISTS property_plots (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  location_id uuid NOT NULL REFERENCES city_locations(id),
  name text NOT NULL,
  property_type text NOT NULL CHECK (property_type IN ('commercial','industrial','agricultural','creative')),
  size_class text NOT NULL CHECK (size_class IN ('shared','small','medium')),
  base_value_minor bigint NOT NULL CHECK (base_value_minor > 0),
  construction_cost_minor bigint NOT NULL CHECK (construction_cost_minor > 0),
  maintenance_minor bigint NOT NULL CHECK (maintenance_minor >= 0),
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','owned','reserved')),
  max_level integer NOT NULL DEFAULT 5 CHECK (max_level BETWEEN 1 AND 10),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS property_ownerships (
  plot_id uuid PRIMARY KEY REFERENCES property_plots(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  acquired_by uuid NOT NULL REFERENCES users(id),
  acquired_price_minor bigint NOT NULL CHECK (acquired_price_minor > 0),
  acquired_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS property_buildings (
  id uuid PRIMARY KEY,
  plot_id uuid NOT NULL UNIQUE REFERENCES property_plots(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  building_type text NOT NULL,
  name text NOT NULL,
  level integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 10),
  condition integer NOT NULL DEFAULT 100 CHECK (condition BETWEEN 0 AND 100),
  capacity integer NOT NULL DEFAULT 10 CHECK (capacity > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','closed')),
  built_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS property_visits (
  id uuid PRIMARY KEY,
  plot_id uuid NOT NULL REFERENCES property_plots(id),
  visitor_id uuid NOT NULL REFERENCES users(id),
  idempotency_key text NOT NULL UNIQUE,
  visited_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_equity (
  company_id uuid PRIMARY KEY REFERENCES companies(id),
  total_units integer NOT NULL DEFAULT 10000 CHECK (total_units > 0),
  outside_limit_units integer NOT NULL DEFAULT 4000
    CHECK (outside_limit_units >= 0 AND outside_limit_units <= total_units),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_equity_positions (
  company_id uuid NOT NULL REFERENCES companies(id),
  user_id uuid NOT NULL REFERENCES users(id),
  units integer NOT NULL CHECK (units >= 0),
  average_cost_minor bigint NOT NULL DEFAULT 0 CHECK (average_cost_minor >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,user_id)
);

CREATE TABLE IF NOT EXISTS company_share_offerings (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id),
  created_by uuid NOT NULL REFERENCES users(id),
  units_total integer NOT NULL CHECK (units_total > 0),
  units_remaining integer NOT NULL CHECK (units_remaining >= 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','filled','cancelled')),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS company_operating_cycles (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id),
  building_id uuid NOT NULL REFERENCES property_buildings(id),
  cycle_number integer NOT NULL CHECK (cycle_number > 0),
  revenue_minor bigint NOT NULL CHECK (revenue_minor >= 0),
  operating_cost_minor bigint NOT NULL CHECK (operating_cost_minor >= 0),
  maintenance_minor bigint NOT NULL CHECK (maintenance_minor >= 0),
  tax_minor bigint NOT NULL CHECK (tax_minor >= 0),
  net_result_minor bigint NOT NULL,
  status text NOT NULL DEFAULT 'settled' CHECK (status IN ('settled','distributed')),
  ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id,cycle_number)
);

CREATE TABLE IF NOT EXISTS company_distributions (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id),
  operating_cycle_id uuid NOT NULL UNIQUE REFERENCES company_operating_cycles(id),
  distributable_minor bigint NOT NULL CHECK (distributable_minor > 0),
  ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_distribution_payments (
  distribution_id uuid NOT NULL REFERENCES company_distributions(id),
  user_id uuid NOT NULL REFERENCES users(id),
  units integer NOT NULL CHECK (units > 0),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  PRIMARY KEY (distribution_id,user_id)
);

CREATE INDEX IF NOT EXISTS property_plot_location_idx ON property_plots(location_id,status);
CREATE INDEX IF NOT EXISTS property_visit_plot_time_idx ON property_visits(plot_id,visited_at DESC);
CREATE INDEX IF NOT EXISTS company_cycle_company_time_idx ON company_operating_cycles(company_id,created_at DESC);
CREATE INDEX IF NOT EXISTS share_offering_open_idx ON company_share_offerings(company_id,created_at)
  WHERE status='open';

INSERT INTO ledger_accounts (id,code,owner_id,account_type) VALUES
  ('a5555555-5555-4555-8555-555555555555','company.padaria-aurora','11111111-1111-4111-8111-111111111111','company'),
  ('a6666666-6666-4666-8666-666666666666','company.horizonte-comercio','22222222-2222-4222-8222-222222222222','company')
ON CONFLICT (code) DO NOTHING;

INSERT INTO property_plots (
  id,code,location_id,name,property_type,size_class,
  base_value_minor,construction_cost_minor,maintenance_minor,status,max_level,metadata
) VALUES
  ('71000000-0000-4000-8000-000000000001','central-market-unit','f2000000-0000-4000-8000-000000000002',
   'Unidade do Mercado Aurora','commercial','shared',6000,4000,600,'available',5,
   '{"businessTypes":["bakery","retail"],"footfall":"high"}'::jsonb),
  ('71000000-0000-4000-8000-000000000002','green-mill-unit','f2000000-0000-4000-8000-000000000006',
   'Moinho Cooperativo','agricultural','small',7000,5000,500,'available',5,
   '{"businessTypes":["mill","food-processing"],"resourceBonus":"wheat"}'::jsonb),
  ('71000000-0000-4000-8000-000000000003','industrial-workshop-unit','f2000000-0000-4000-8000-000000000003',
   'Oficina Industrial Modular','industrial','small',9000,7000,900,'available',5,
   '{"businessTypes":["workshop","manufacturing"],"energyDemand":"medium"}'::jsonb),
  ('71000000-0000-4000-8000-000000000004','creative-studio-unit','f2000000-0000-4000-8000-000000000007',
   'Estúdio do Campus Criativo','creative','shared',8000,5500,650,'available',5,
   '{"businessTypes":["studio","agency"],"audience":"creative"}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  name=EXCLUDED.name,property_type=EXCLUDED.property_type,size_class=EXCLUDED.size_class,
  base_value_minor=EXCLUDED.base_value_minor,construction_cost_minor=EXCLUDED.construction_cost_minor,
  maintenance_minor=EXCLUDED.maintenance_minor,max_level=EXCLUDED.max_level,metadata=EXCLUDED.metadata;

INSERT INTO company_equity (company_id,total_units,outside_limit_units) VALUES
  ('41111111-1111-4111-8111-111111111111',10000,4000),
  ('42222222-2222-4222-8222-222222222222',10000,4000)
ON CONFLICT (company_id) DO NOTHING;

INSERT INTO company_equity_positions (company_id,user_id,units,average_cost_minor) VALUES
  ('41111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111',10000,0),
  ('42222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222',10000,0)
ON CONFLICT (company_id,user_id) DO NOTHING;

COMMIT;
