BEGIN;

CREATE TABLE IF NOT EXISTS game_npcs (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  role_title text NOT NULL,
  location_id uuid NOT NULL REFERENCES city_locations(id),
  avatar text NOT NULL,
  dialogue jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player_avatar_state (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  avatar_code text NOT NULL DEFAULT 'founder-01',
  facing text NOT NULL DEFAULT 'south' CHECK (facing IN ('north','south','east','west')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS harvest_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  job_assignment_id uuid NOT NULL REFERENCES player_job_assignments(id),
  challenge jsonb NOT NULL,
  score integer NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  status text NOT NULL CHECK (status IN ('active','completed','failed','expired')),
  idempotency_key text NOT NULL UNIQUE,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS harvest_active_user_idx
  ON harvest_sessions (user_id)
  WHERE status='active';
CREATE INDEX IF NOT EXISTS harvest_assignment_status_idx
  ON harvest_sessions (job_assignment_id,status,completed_at DESC);
CREATE INDEX IF NOT EXISTS game_npcs_location_idx
  ON game_npcs (location_id,name);

INSERT INTO game_npcs (
  id,code,name,role_title,location_id,avatar,dialogue
) VALUES
  (
    'a1000000-0000-4000-8000-000000000001',
    'mara-coordinator',
    'Mara',
    'Coordenadora de Empregos',
    'f2000000-0000-4000-8000-000000000001',
    'mara',
    '[
      "Bem-vindo a Nova Aurora. Aqui, cada trabalho fortalece uma cadeia produtiva.",
      "A Cooperativa do Vale Verde precisa de ajuda com a colheita.",
      "Produza com cuidado: sua reputação começa na primeira entrega."
    ]'::jsonb
  ),
  (
    'a1000000-0000-4000-8000-000000000002',
    'joao-farmer',
    'João',
    'Mestre Agricultor',
    'f2000000-0000-4000-8000-000000000005',
    'joao',
    '[
      "Observe o ritmo do campo antes de cortar.",
      "Uma colheita precisa é mais valiosa do que uma colheita apressada.",
      "Complete a sequência correta e o trigo estará pronto para o moinho."
    ]'::jsonb
  ),
  (
    'a1000000-0000-4000-8000-000000000003',
    'lina-merchant',
    'Lina',
    'Comerciante Municipal',
    'f2000000-0000-4000-8000-000000000002',
    'lina',
    '[
      "O melhor preço nem sempre é o menor: qualidade e confiança também importam.",
      "As ordens são atendidas por preço e pela ordem de chegada.",
      "Publique seu pão e acompanhe a cidade responder à oferta."
    ]'::jsonb
  )
ON CONFLICT (code) DO UPDATE SET
  name=EXCLUDED.name,
  role_title=EXCLUDED.role_title,
  location_id=EXCLUDED.location_id,
  avatar=EXCLUDED.avatar,
  dialogue=EXCLUDED.dialogue;

INSERT INTO player_avatar_state (user_id,avatar_code,facing) VALUES
  ('11111111-1111-4111-8111-111111111111','founder-01','south'),
  ('22222222-2222-4222-8222-222222222222','trader-01','south')
ON CONFLICT (user_id) DO NOTHING;

COMMIT;
