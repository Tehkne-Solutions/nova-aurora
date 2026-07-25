import postgres from "postgres";
let client: ReturnType<typeof postgres> | undefined;
export function db(): ReturnType<typeof postgres> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada.");
  return client ??= postgres(url, { max: 10, idle_timeout: 20 });
}
