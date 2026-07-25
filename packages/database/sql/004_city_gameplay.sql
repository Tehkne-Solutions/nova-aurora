BEGIN;

CREATE TABLE IF NOT EXISTS city_districts (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  direction text NOT NULL,
  theme text NOT NULL,
  description text NOT NULL,
  sort_order integer NOT NULL
);

CREATE TABLE IF NOT EXISTS city_locations (
  id uuid PRIMARY KEY,
  district_id uuid NOT NULL REFERENCES city_districts(id),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  location_type text NOT NULL,
  map_x integer NOT NULL,
  map_y integer NOT NULL,
  description text NOT NULL
);

CREATE TABLE IF NOT EXISTS player_world_state (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  district_id uuid NOT NULL REFERENCES city_districts(id),
  location_id uuid NOT NULL REFERENCES city_locations(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_jobs (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL,
  required_location_id uuid NOT NULL REFERENCES city_locations(id),
  reward_minor bigint NOT NULL CHECK (reward_minor >= 0),
  reward_item_id uuid REFERENCES items(id),
  reward_item_quantity_minor bigint NOT NULL DEFAULT 0 CHECK (reward_item_quantity_minor >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived'))
);

CREATE TABLE IF NOT EXISTS player_job_assignments (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  job_id uuid NOT NULL REFERENCES public_jobs(id),
  status text NOT NULL CHECK (status IN ('accepted','completed','cancelled')),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (user_id, job_id)
);

CREATE TABLE IF NOT EXISTS city_action_log (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  action_code text NOT NULL,
  district_id uuid REFERENCES city_districts(id),
  location_id uuid REFERENCES city_locations(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS city_action_user_time_idx
  ON city_action_log (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS city_location_district_idx
  ON city_locations (district_id, map_y, map_x);
CREATE INDEX IF NOT EXISTS player_job_user_status_idx
  ON player_job_assignments (user_id, status);

INSERT INTO city_districts (id,code,name,direction,theme,description,sort_order) VALUES
  ('f1000000-0000-4000-8000-000000000001','central','Centro Cívico','Oeste','civic','Comércio, serviços públicos e circulação de pessoas.',1),
  ('f1000000-0000-4000-8000-000000000002','industrial','Cinturão Industrial','Leste','industrial','Fábricas, oficinas, energia e logística pesada.',2),
  ('f1000000-0000-4000-8000-000000000003','green-valley','Vale Verde','Norte','green','Agricultura, recursos renováveis e produção de alimentos.',3),
  ('f1000000-0000-4000-8000-000000000004','creative','Distrito Criativo','Sul','creative','Tecnologia, cultura, gastronomia e experiências.',4)
ON CONFLICT (code) DO UPDATE SET
  name=EXCLUDED.name,direction=EXCLUDED.direction,theme=EXCLUDED.theme,
  description=EXCLUDED.description,sort_order=EXCLUDED.sort_order;

INSERT INTO city_locations (id,district_id,code,name,location_type,map_x,map_y,description) VALUES
  ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','employment-center','Centro de Empregos','public-service',1,2,'Vagas, trabalhos públicos e formação inicial.'),
  ('f2000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000001','municipal-market','Mercado Municipal','market',2,1,'Livro de ofertas, preços e comércio da cidade.'),
  ('f2000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000002','industrial-workshop','Oficina Pública','production',3,1,'Ferramentas, reparos e produção técnica.'),
  ('f2000000-0000-4000-8000-000000000004','f1000000-0000-4000-8000-000000000002','logistics-terminal','Terminal Logístico','logistics',4,2,'Cargas, rotas e distribuição entre distritos.'),
  ('f2000000-0000-4000-8000-000000000005','f1000000-0000-4000-8000-000000000003','harvest-fields','Campos de Colheita','resource',1,0,'Área agrícola usada no primeiro trabalho produtivo.'),
  ('f2000000-0000-4000-8000-000000000006','f1000000-0000-4000-8000-000000000003','green-cooperative','Cooperativa Agrícola','cooperative',2,0,'Armazenamento, contratos e apoio aos produtores.'),
  ('f2000000-0000-4000-8000-000000000007','f1000000-0000-4000-8000-000000000004','creative-campus','Campus Criativo','education',2,3,'Design, tecnologia e desenvolvimento profissional.'),
  ('f2000000-0000-4000-8000-000000000008','f1000000-0000-4000-8000-000000000004','event-plaza','Praça dos Eventos','event',3,3,'Festivais, apresentações e experiências sociais.')
ON CONFLICT (code) DO UPDATE SET
  district_id=EXCLUDED.district_id,name=EXCLUDED.name,location_type=EXCLUDED.location_type,
  map_x=EXCLUDED.map_x,map_y=EXCLUDED.map_y,description=EXCLUDED.description;

INSERT INTO player_world_state (user_id,district_id,location_id) VALUES
  ('11111111-1111-4111-8111-111111111111','f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001'),
  ('22222222-2222-4222-8222-222222222222','f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public_jobs (
  id,code,title,description,required_location_id,reward_minor,
  reward_item_id,reward_item_quantity_minor,status
) VALUES (
  'f3000000-0000-4000-8000-000000000001',
  'harvest-support',
  'Apoio à Colheita',
  'Ajude a cooperativa a colher trigo para a Cesta de Boas-Vindas.',
  'f2000000-0000-4000-8000-000000000005',
  3000,
  'b0000000-0000-4000-8000-000000000002',
  400,
  'active'
)
ON CONFLICT (code) DO UPDATE SET
  title=EXCLUDED.title,description=EXCLUDED.description,
  required_location_id=EXCLUDED.required_location_id,reward_minor=EXCLUDED.reward_minor,
  reward_item_id=EXCLUDED.reward_item_id,
  reward_item_quantity_minor=EXCLUDED.reward_item_quantity_minor,status='active';

COMMIT;
