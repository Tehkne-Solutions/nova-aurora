import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não configurada.");
const sql = postgres(url, { max: 1 });
await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
const dir = new URL("../sql/", import.meta.url);
const names = (await fs.readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
for (const name of names) {
  const applied = await sql`SELECT 1 FROM schema_migrations WHERE name = ${name}`;
  if (applied.length) continue;
  const source = await fs.readFile(new URL(name, dir), "utf8");
  await sql.begin(async (tx) => { await tx.unsafe(source); await tx`INSERT INTO schema_migrations (name) VALUES (${name})`; });
  console.log(`applied ${name}`);
}
await sql.end();
