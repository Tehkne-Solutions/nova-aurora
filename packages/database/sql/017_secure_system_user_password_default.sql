BEGIN;

ALTER TABLE users
  ALTER COLUMN password_hash
  SET DEFAULT crypt(encode(gen_random_bytes(32),'hex'),gen_salt('bf',12));

COMMENT ON COLUMN users.password_hash IS
  'Hash bcrypt. Usuários criados por rotinas internas recebem segredo aleatório não recuperável e não possuem credencial conhecida.';

COMMIT;
