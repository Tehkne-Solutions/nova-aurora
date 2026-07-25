BEGIN;

ALTER TABLE city_districts
  ADD COLUMN IF NOT EXISTS expansion_status text NOT NULL DEFAULT 'active'
    CHECK (expansion_status IN ('planned','funding','active','paused')),
  ADD COLUMN IF NOT EXISTS population integer NOT NULL DEFAULT 1000 CHECK (population >= 0),
  ADD COLUMN IF NOT EXISTS quality_of_life_score integer NOT NULL DEFAULT 60
    CHECK (quality_of_life_score BETWEEN 0 AND 100);

CREATE TABLE IF NOT EXISTS business_license_types (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  fee_minor bigint NOT NULL CHECK (fee_minor >= 0),
  duration_days integer NOT NULL CHECK (duration_days > 0),
  allowed_property_type text
);

CREATE TABLE IF NOT EXISTS business_licenses (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id),
  district_id uuid NOT NULL REFERENCES city_districts(id),
  license_type_code text NOT NULL REFERENCES business_license_types(code),
  requested_by uuid NOT NULL REFERENCES users(id),
  fee_minor bigint NOT NULL CHECK (fee_minor >= 0),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('requested','active','suspended','expired','cancelled')),
  ledger_transaction_id uuid REFERENCES ledger_transactions(id),
  idempotency_key text NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (company_id,district_id,license_type_code)
);

CREATE TABLE IF NOT EXISTS public_contracts (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  district_id uuid REFERENCES city_districts(id),
  title text NOT NULL,
  description text NOT NULL,
  category text NOT NULL CHECK (category IN ('energy','transport','safety','housing','education','environment','events')),
  budget_minor bigint NOT NULL CHECK (budget_minor > 0),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','awarded','completed','cancelled')),
  bidding_deadline timestamptz NOT NULL,
  awarded_bid_id uuid,
  awarded_company_id uuid REFERENCES companies(id),
  awarded_amount_minor bigint CHECK (awarded_amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public_contract_bids (
  id uuid PRIMARY KEY,
  contract_id uuid NOT NULL REFERENCES public_contracts(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  bidder_id uuid NOT NULL REFERENCES users(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  delivery_days integer NOT NULL CHECK (delivery_days BETWEEN 1 AND 365),
  proposal text NOT NULL,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','awarded','rejected','withdrawn')),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id,company_id)
);

CREATE TABLE IF NOT EXISTS participatory_budget_proposals (
  id uuid PRIMARY KEY,
  district_id uuid NOT NULL REFERENCES city_districts(id),
  created_by uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  description text NOT NULL,
  category text NOT NULL CHECK (category IN ('energy','transport','safety','housing','education','environment','events','expansion')),
  requested_budget_minor bigint NOT NULL CHECK (requested_budget_minor > 0),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','funded','rejected','completed','cancelled')),
  support_score integer NOT NULL DEFAULT 0 CHECK (support_score >= 0),
  opposition_score integer NOT NULL DEFAULT 0 CHECK (opposition_score >= 0),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  closes_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS participatory_budget_votes (
  proposal_id uuid NOT NULL REFERENCES participatory_budget_proposals(id),
  user_id uuid NOT NULL REFERENCES users(id),
  choice text NOT NULL CHECK (choice IN ('support','oppose')),
  weight integer NOT NULL CHECK (weight BETWEEN 1 AND 5),
  civic_reputation_at_vote integer NOT NULL CHECK (civic_reputation_at_vote BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (proposal_id,user_id)
);

CREATE TABLE IF NOT EXISTS urban_service_metrics (
  district_id uuid PRIMARY KEY REFERENCES city_districts(id),
  energy_score integer NOT NULL DEFAULT 60 CHECK (energy_score BETWEEN 0 AND 100),
  transport_score integer NOT NULL DEFAULT 60 CHECK (transport_score BETWEEN 0 AND 100),
  safety_score integer NOT NULL DEFAULT 60 CHECK (safety_score BETWEEN 0 AND 100),
  education_score integer NOT NULL DEFAULT 60 CHECK (education_score BETWEEN 0 AND 100),
  environment_score integer NOT NULL DEFAULT 60 CHECK (environment_score BETWEEN 0 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS civic_reputation (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  score integer NOT NULL DEFAULT 50 CHECK (score BETWEEN 0 AND 100),
  proposals_submitted integer NOT NULL DEFAULT 0 CHECK (proposals_submitted >= 0),
  votes_cast integer NOT NULL DEFAULT 0 CHECK (votes_cast >= 0),
  contracts_completed integer NOT NULL DEFAULT 0 CHECK (contracts_completed >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_investments (
  id uuid PRIMARY KEY,
  proposal_id uuid UNIQUE REFERENCES participatory_budget_proposals(id),
  contract_id uuid UNIQUE REFERENCES public_contracts(id),
  district_id uuid NOT NULL REFERENCES city_districts(id),
  category text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
  executed_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((proposal_id IS NOT NULL) <> (contract_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS business_license_company_idx
  ON business_licenses (company_id,status,expires_at);
CREATE INDEX IF NOT EXISTS public_contract_status_idx
  ON public_contracts (status,bidding_deadline);
CREATE INDEX IF NOT EXISTS public_contract_bid_contract_idx
  ON public_contract_bids (contract_id,status,amount_minor,created_at);
CREATE INDEX IF NOT EXISTS participatory_proposal_status_idx
  ON participatory_budget_proposals (status,closes_at);

INSERT INTO city_districts (
  id,code,name,direction,theme,description,sort_order,
  expansion_status,population,quality_of_life_score
) VALUES
  ('f1000000-0000-4000-8000-000000000005','residential','Bairro Horizonte','Noroeste','residential',
   'Moradia, serviços de bairro, convivência e qualidade de vida.',5,'planned',0,55),
  ('f1000000-0000-4000-8000-000000000006','technology-park','Parque Tecnológico','Sudeste','technology',
   'Universidade, pesquisa, inovação e empresas de tecnologia.',6,'planned',0,58)
ON CONFLICT (code) DO UPDATE SET
  name=EXCLUDED.name,direction=EXCLUDED.direction,theme=EXCLUDED.theme,
  description=EXCLUDED.description,sort_order=EXCLUDED.sort_order;

INSERT INTO city_locations (
  id,district_id,code,name,location_type,map_x,map_y,description
) VALUES
  ('f2000000-0000-4000-8000-000000000009','f1000000-0000-4000-8000-000000000005',
   'community-center','Centro Comunitário','public-service',0,2,
   'Propostas locais, serviços sociais e encontros de moradores.'),
  ('f2000000-0000-4000-8000-000000000010','f1000000-0000-4000-8000-000000000005',
   'residential-square','Praça Horizonte','residential',0,3,
   'Área de convivência e comércio de proximidade.'),
  ('f2000000-0000-4000-8000-000000000011','f1000000-0000-4000-8000-000000000006',
   'nova-aurora-university','Universidade de Nova Aurora','education',4,3,
   'Pesquisa, formação avançada e projetos de inovação.'),
  ('f2000000-0000-4000-8000-000000000012','f1000000-0000-4000-8000-000000000006',
   'innovation-lab','Laboratório de Inovação','technology',5,2,
   'Protótipos, automação e desenvolvimento tecnológico.')
ON CONFLICT (code) DO UPDATE SET
  district_id=EXCLUDED.district_id,name=EXCLUDED.name,location_type=EXCLUDED.location_type,
  map_x=EXCLUDED.map_x,map_y=EXCLUDED.map_y,description=EXCLUDED.description;

INSERT INTO property_plots (
  id,code,location_id,name,property_type,size_class,
  base_value_minor,construction_cost_minor,maintenance_minor,status,max_level,metadata
) VALUES
  ('71000000-0000-4000-8000-000000000005','horizon-neighborhood-unit',
   'f2000000-0000-4000-8000-000000000010','Unidade Comercial Horizonte',
   'commercial','small',8500,6500,700,'available',5,
   '{"businessTypes":["retail","services"],"district":"residential"}'::jsonb),
  ('71000000-0000-4000-8000-000000000006','technology-studio-unit',
   'f2000000-0000-4000-8000-000000000012','Estúdio de Tecnologia Aplicada',
   'creative','small',11000,9000,950,'available',6,
   '{"businessTypes":["technology","education"],"district":"technology-park"}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  name=EXCLUDED.name,base_value_minor=EXCLUDED.base_value_minor,
  construction_cost_minor=EXCLUDED.construction_cost_minor,
  maintenance_minor=EXCLUDED.maintenance_minor,max_level=EXCLUDED.max_level,
  metadata=EXCLUDED.metadata;

INSERT INTO business_license_types (
  code,name,description,fee_minor,duration_days,allowed_property_type
) VALUES
  ('local-commerce','Licença de Comércio Local','Autoriza varejo e serviços de proximidade.',1200,30,'commercial'),
  ('industrial-operation','Licença de Operação Industrial','Autoriza produção e operação industrial.',2800,30,'industrial'),
  ('creative-services','Licença de Serviços Criativos','Autoriza estúdios, agências e educação criativa.',1800,30,'creative'),
  ('agricultural-production','Licença de Produção Agrícola','Autoriza produção e processamento agrícola.',1500,30,'agricultural')
ON CONFLICT (code) DO UPDATE SET
  name=EXCLUDED.name,description=EXCLUDED.description,fee_minor=EXCLUDED.fee_minor,
  duration_days=EXCLUDED.duration_days,allowed_property_type=EXCLUDED.allowed_property_type;

INSERT INTO urban_service_metrics (district_id)
SELECT id FROM city_districts
ON CONFLICT (district_id) DO NOTHING;

INSERT INTO civic_reputation (user_id,score)
VALUES
  ('11111111-1111-4111-8111-111111111111',55),
  ('22222222-2222-4222-8222-222222222222',52)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO ledger_accounts (id,code,owner_id,account_type)
VALUES ('a7777777-7777-4777-8777-777777777777','city.public-investment',NULL,'city-budget')
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE transaction_id uuid := 'b7777777-7777-4777-8777-777777777777';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ledger_transactions WHERE idempotency_key='seed:governance:public-investment'
  ) THEN
    INSERT INTO ledger_transactions (id,idempotency_key,transaction_type)
    VALUES (transaction_id,'seed:governance:public-investment','city-budget-allocation');
    INSERT INTO ledger_entries (transaction_id,account_id,amount_minor,memo) VALUES
      (transaction_id,'a4444444-4444-4444-8444-444444444444',-250000,'Dotação para investimentos públicos'),
      (transaction_id,'a7777777-7777-4777-8777-777777777777',250000,'Fundo de investimentos públicos');
    PERFORM assert_balanced(transaction_id);
  END IF;
END $$;

INSERT INTO public_contracts (
  id,code,district_id,title,description,category,budget_minor,status,bidding_deadline
) VALUES
  ('c9000000-0000-4000-8000-000000000001','green-mobility-corridor',
   'f1000000-0000-4000-8000-000000000003','Corredor Verde de Mobilidade',
   'Implantar rota de transporte sustentável entre Vale Verde e Centro Cívico.',
   'transport',48000,'open',now()+interval '14 days'),
  ('c9000000-0000-4000-8000-000000000002','technology-campus-energy',
   'f1000000-0000-4000-8000-000000000006','Energia do Parque Tecnológico',
   'Instalar infraestrutura energética para ativar o novo distrito tecnológico.',
   'energy',62000,'open',now()+interval '14 days')
ON CONFLICT (code) DO UPDATE SET
  title=EXCLUDED.title,description=EXCLUDED.description,category=EXCLUDED.category,
  budget_minor=EXCLUDED.budget_minor;

COMMIT;
