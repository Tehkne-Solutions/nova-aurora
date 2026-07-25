BEGIN;

CREATE TABLE IF NOT EXISTS municipal_budget_cycles (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('planned','open','closed','cancelled')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  opening_treasury_minor bigint NOT NULL DEFAULT 0,
  tax_revenue_minor bigint NOT NULL DEFAULT 0 CHECK (tax_revenue_minor >= 0),
  license_revenue_minor bigint NOT NULL DEFAULT 0 CHECK (license_revenue_minor >= 0),
  service_cost_minor bigint NOT NULL DEFAULT 0 CHECK (service_cost_minor >= 0),
  emergency_cost_minor bigint NOT NULL DEFAULT 0 CHECK (emergency_cost_minor >= 0),
  closing_treasury_minor bigint,
  settled_by uuid REFERENCES users(id),
  ledger_transaction_id uuid REFERENCES ledger_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS municipal_service_operations (
  district_id uuid NOT NULL REFERENCES city_districts(id),
  service_code text NOT NULL
    CHECK (service_code IN ('energy','transport','safety','education','environment')),
  monthly_cost_minor bigint NOT NULL CHECK (monthly_cost_minor > 0),
  condition_score integer NOT NULL DEFAULT 70 CHECK (condition_score BETWEEN 0 AND 100),
  capacity_score integer NOT NULL DEFAULT 65 CHECK (capacity_score BETWEEN 0 AND 100),
  degradation_rate integer NOT NULL DEFAULT 4 CHECK (degradation_rate BETWEEN 1 AND 20),
  status text NOT NULL DEFAULT 'operational'
    CHECK (status IN ('operational','strained','critical','offline')),
  last_maintained_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (district_id,service_code)
);

CREATE TABLE IF NOT EXISTS municipal_service_cycle_results (
  id uuid PRIMARY KEY,
  budget_cycle_id uuid NOT NULL REFERENCES municipal_budget_cycles(id),
  district_id uuid NOT NULL REFERENCES city_districts(id),
  service_code text NOT NULL,
  cost_minor bigint NOT NULL CHECK (cost_minor >= 0),
  condition_before integer NOT NULL CHECK (condition_before BETWEEN 0 AND 100),
  condition_after integer NOT NULL CHECK (condition_after BETWEEN 0 AND 100),
  capacity_after integer NOT NULL CHECK (capacity_after BETWEEN 0 AND 100),
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (budget_cycle_id,district_id,service_code)
);

CREATE TABLE IF NOT EXISTS civic_elections (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  office text NOT NULL,
  seats integer NOT NULL DEFAULT 2 CHECK (seats BETWEEN 1 AND 12),
  status text NOT NULL DEFAULT 'registration'
    CHECK (status IN ('registration','voting','certified','cancelled')),
  registration_deadline timestamptz NOT NULL,
  voting_opens_at timestamptz NOT NULL,
  voting_closes_at timestamptz NOT NULL,
  certified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (voting_closes_at > voting_opens_at)
);

CREATE TABLE IF NOT EXISTS civic_candidates (
  id uuid PRIMARY KEY,
  election_id uuid NOT NULL REFERENCES civic_elections(id),
  user_id uuid NOT NULL REFERENCES users(id),
  slogan text NOT NULL,
  platform text NOT NULL,
  reputation_at_registration integer NOT NULL CHECK (reputation_at_registration BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','elected','not-elected','withdrawn','disqualified')),
  votes integer NOT NULL DEFAULT 0 CHECK (votes >= 0),
  idempotency_key text NOT NULL UNIQUE,
  registered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (election_id,user_id)
);

CREATE TABLE IF NOT EXISTS civic_ballots (
  election_id uuid NOT NULL REFERENCES civic_elections(id),
  voter_id uuid NOT NULL REFERENCES users(id),
  candidate_id uuid NOT NULL REFERENCES civic_candidates(id),
  idempotency_key text NOT NULL UNIQUE,
  cast_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (election_id,voter_id)
);

CREATE TABLE IF NOT EXISTS civic_mandates (
  id uuid PRIMARY KEY,
  election_id uuid NOT NULL REFERENCES civic_elections(id),
  user_id uuid NOT NULL REFERENCES users(id),
  office text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','completed','revoked','resigned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (election_id,user_id),
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS public_policy_proposals (
  id uuid PRIMARY KEY,
  created_by uuid NOT NULL REFERENCES users(id),
  district_id uuid REFERENCES city_districts(id),
  title text NOT NULL,
  description text NOT NULL,
  policy_area text NOT NULL
    CHECK (policy_area IN ('energy','transport','safety','education','environment','housing','fiscal')),
  budget_impact_minor bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'debate'
    CHECK (status IN ('debate','approved','rejected','active','expired','cancelled')),
  votes_for integer NOT NULL DEFAULT 0 CHECK (votes_for >= 0),
  votes_against integer NOT NULL DEFAULT 0 CHECK (votes_against >= 0),
  idempotency_key text NOT NULL UNIQUE,
  voting_ends_at timestamptz NOT NULL,
  enacted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_policy_votes (
  proposal_id uuid NOT NULL REFERENCES public_policy_proposals(id),
  council_member_id uuid NOT NULL REFERENCES users(id),
  choice text NOT NULL CHECK (choice IN ('support','oppose')),
  idempotency_key text NOT NULL UNIQUE,
  voted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (proposal_id,council_member_id)
);

CREATE TABLE IF NOT EXISTS city_emergencies (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  district_id uuid NOT NULL REFERENCES city_districts(id),
  event_type text NOT NULL
    CHECK (event_type IN ('energy-failure','transport-collapse','security-incident','flood','heat-wave')),
  severity integer NOT NULL CHECK (severity BETWEEN 1 AND 5),
  title text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','responding','resolved','expired')),
  response_cost_minor bigint NOT NULL CHECK (response_cost_minor > 0),
  service_impacts jsonb NOT NULL DEFAULT '{}'::jsonb,
  triggered_by uuid NOT NULL REFERENCES users(id),
  resolved_by uuid REFERENCES users(id),
  ledger_transaction_id uuid REFERENCES ledger_transactions(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS city_approval_snapshots (
  id uuid PRIMARY KEY,
  budget_cycle_id uuid REFERENCES municipal_budget_cycles(id),
  approval_score integer NOT NULL CHECK (approval_score BETWEEN 0 AND 100),
  transparency_score integer NOT NULL CHECK (transparency_score BETWEEN 0 AND 100),
  service_score integer NOT NULL CHECK (service_score BETWEEN 0 AND 100),
  fiscal_score integer NOT NULL CHECK (fiscal_score BETWEEN 0 AND 100),
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS municipal_budget_status_idx
  ON municipal_budget_cycles(status,starts_at DESC);
CREATE INDEX IF NOT EXISTS municipal_service_status_idx
  ON municipal_service_operations(status,condition_score);
CREATE INDEX IF NOT EXISTS civic_election_status_idx
  ON civic_elections(status,voting_closes_at);
CREATE INDEX IF NOT EXISTS civic_candidate_election_idx
  ON civic_candidates(election_id,status,votes DESC);
CREATE INDEX IF NOT EXISTS civic_mandate_active_idx
  ON civic_mandates(user_id,ends_at) WHERE status='active';
CREATE INDEX IF NOT EXISTS public_policy_status_idx
  ON public_policy_proposals(status,voting_ends_at);
CREATE INDEX IF NOT EXISTS city_emergency_status_idx
  ON city_emergencies(status,severity DESC,started_at DESC);

INSERT INTO ledger_accounts (id,code,owner_id,account_type) VALUES
  ('a8888888-8888-4888-8888-888888888888','city.service-operations',NULL,'city-budget'),
  ('a9999999-9999-4999-8999-999999999999','city.emergency-reserve',NULL,'city-budget')
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE transaction_id uuid := 'b8888888-8888-4888-8888-888888888888';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ledger_transactions WHERE idempotency_key='seed:municipal:operating-reserves'
  ) THEN
    INSERT INTO ledger_transactions (id,idempotency_key,transaction_type)
    VALUES (transaction_id,'seed:municipal:operating-reserves','municipal-reserve-allocation');
    INSERT INTO ledger_entries (transaction_id,account_id,amount_minor,memo) VALUES
      (transaction_id,'a4444444-4444-4444-8444-444444444444',-400000,'Dotação inicial de operações municipais'),
      (transaction_id,'a8888888-8888-4888-8888-888888888888',300000,'Fundo de serviços urbanos'),
      (transaction_id,'a9999999-9999-4999-8999-999999999999',100000,'Reserva de emergências urbanas');
    PERFORM assert_balanced(transaction_id);
  END IF;
END $$;

INSERT INTO municipal_service_operations (
  district_id,service_code,monthly_cost_minor,condition_score,capacity_score,degradation_rate
)
SELECT district.id,service.code,service.cost_minor,service.condition_score,
  service.capacity_score,service.degradation_rate
FROM city_districts district
CROSS JOIN (VALUES
  ('energy',700,72,68,4),
  ('transport',650,70,66,5),
  ('safety',600,74,68,4),
  ('education',550,69,64,3),
  ('environment',500,73,67,3)
) AS service(code,cost_minor,condition_score,capacity_score,degradation_rate)
ON CONFLICT (district_id,service_code) DO NOTHING;

INSERT INTO municipal_budget_cycles (
  id,code,status,starts_at,ends_at,opening_treasury_minor
) VALUES (
  'd1000000-0000-4000-8000-000000000001','2026-Q3','open',
  now(),now()+interval '30 days',0
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO civic_elections (
  id,code,title,office,seats,status,registration_deadline,voting_opens_at,voting_closes_at
) VALUES (
  'd2000000-0000-4000-8000-000000000001','council-2026-q3',
  'Eleição do Conselho Municipal — 2026 Q3','Conselheiro Municipal',2,'registration',
  now()+interval '7 days',now()+interval '7 days',now()+interval '14 days'
)
ON CONFLICT (code) DO NOTHING;

COMMIT;
