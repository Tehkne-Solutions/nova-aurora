import { readFile } from "node:fs/promises";

async function readSecret(path, label, required = true) {
  if (!path) {
    if (required) throw new Error(`${label} não configurado.`);
    return undefined;
  }
  const value = (await readFile(path, "utf8")).trim();
  if (!value && required) throw new Error(`${label} está vazio.`);
  return value || undefined;
}

export async function loadRuntimeSecrets() {
  const password = await readSecret(
    process.env.POSTGRES_PASSWORD_FILE,
    "POSTGRES_PASSWORD_FILE"
  );
  const internalToken = await readSecret(
    process.env.INTERNAL_API_TOKEN_FILE,
    "INTERNAL_API_TOKEN_FILE"
  );
  if (internalToken.length < 24) {
    throw new Error("O token interno deve possuir pelo menos 24 caracteres.");
  }

  const user = process.env.POSTGRES_USER ?? "nova_aurora";
  const database = process.env.POSTGRES_DB ?? "nova_aurora";
  const host = process.env.POSTGRES_HOST ?? "postgres";
  const port = process.env.POSTGRES_PORT ?? "5432";
  process.env.DATABASE_URL ??=
    `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}`
    + `@${host}:${port}/${encodeURIComponent(database)}`;
  process.env.INTERNAL_API_TOKEN = internalToken;

  return {
    databaseUrl: process.env.DATABASE_URL,
    internalToken
  };
}

export async function optionalSecret(path, label) {
  return readSecret(path, label, false);
}
