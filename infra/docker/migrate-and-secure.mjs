import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import postgres from "postgres";
import { loadRuntimeSecrets, optionalSecret } from "./runtime-secrets.mjs";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Comando falhou com código ${code ?? "null"} e sinal ${signal ?? "nenhum"}.`));
    });
  });
}

await loadRuntimeSecrets();
await run("pnpm", ["db:migrate"]);

const adminPassword = await optionalSecret(
  process.env.BOOTSTRAP_ADMIN_PASSWORD_FILE,
  "BOOTSTRAP_ADMIN_PASSWORD_FILE"
);
if (!adminPassword || adminPassword.length < 12) {
  throw new Error("A senha administrativa inicial deve possuir pelo menos 12 caracteres.");
}
const bobPassword = await optionalSecret(
  process.env.BOOTSTRAP_BOB_PASSWORD_FILE,
  "BOOTSTRAP_BOB_PASSWORD_FILE"
) ?? randomBytes(32).toString("base64url");
if (bobPassword.length < 12) {
  throw new Error("A senha inicial de Bob deve possuir pelo menos 12 caracteres.");
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await sql.begin(async (tx) => {
    await tx`
      UPDATE users SET
        password_hash=crypt(${adminPassword},gen_salt('bf',12)),
        password_updated_at=now(),updated_at=now(),status='active'
      WHERE email='alice@nova-aurora.local'
    `;
    await tx`
      UPDATE users SET
        password_hash=crypt(${bobPassword},gen_salt('bf',12)),
        password_updated_at=now(),updated_at=now(),
        status=${process.env.ENABLE_BOB_IN_PRODUCTION === "true" ? "active" : "disabled"}
      WHERE email='bob@nova-aurora.local'
    `;
    await tx`
      UPDATE auth_sessions SET status='revoked',revoked_at=now()
      WHERE user_id IN (
        SELECT id FROM users WHERE email IN (
          'alice@nova-aurora.local','bob@nova-aurora.local'
        )
      ) AND status='active'
    `;
    await tx`
      INSERT INTO security_audit_log (
        actor_user_id,subject_user_id,action,outcome,risk_level,metadata
      )
      SELECT id,id,'deployment.credentials.rotate','success','high',
        ${JSON.stringify({ source: "production-bootstrap", signature: "Tehkné Solutions" })}::jsonb
      FROM users WHERE email='alice@nova-aurora.local'
    `;
  });
} finally {
  await sql.end();
}

console.log(JSON.stringify({
  timestamp: new Date().toISOString(),
  level: "info",
  service: "database-bootstrap",
  event: "database.migrated-and-secured",
  bobEnabled: process.env.ENABLE_BOB_IN_PRODUCTION === "true",
  signature: "Tehkné Solutions"
}));
