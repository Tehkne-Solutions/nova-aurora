import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationPath = "packages/database/sql/022_trust_legal_readiness.sql";
const required = [
  migrationPath,
  "packages/database/src/trust-readiness.ts",
  "packages/database/src/trust-readiness.test.ts",
  "apps/api/src/trust-routes.ts",
  "apps/web/src/app/trust/page.tsx",
  "docs/SPRINT_15_TRUST_LEGAL_LAUNCH_READINESS.md",
  "docs/INCIDENT_RESPONSE_PLAN.md",
  "docs/legal/TERMS_OF_USE_DRAFT.md",
  "docs/legal/PRIVACY_NOTICE_DRAFT.md",
  "docs/legal/ASSET_CLASSIFICATION_NOTICE.md",
  "docs/legal/CHILD_SAFETY_POLICY_DRAFT.md",
  "docs/legal/CONSUMER_RIGHTS_DRAFT.md"
];

const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  console.error(`Arquivos ausentes:\n${missing.map((file) => `- ${file}`).join("\n")}`);
  process.exit(1);
}

const migration = fs.readFileSync(path.join(root, migrationPath), "utf8");
for (const table of [
  "trust_legal_documents",
  "trust_age_assurance",
  "trust_document_acceptances",
  "trust_external_reviews",
  "trust_incidents"
]) {
  if (!migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) {
    throw new Error(`Tabela obrigatória ausente: ${table}`);
  }
}

const service = fs.readFileSync(
  path.join(root, "packages/database/src/trust-readiness.ts"),
  "utf8"
);
for (const invariant of [
  "TRUST_ENFORCEMENT_MODE",
  "Hash SHA-256 obrigatório",
  "Relatório externo obrigatório",
  "Incidentes críticos abertos",
  "A Nova Aurora não está disponível para menores de 14 anos"
]) {
  if (!service.includes(invariant)) {
    throw new Error(`Invariante ausente: ${invariant}`);
  }
}

console.log("Sprint 15 validada: Trust, Legal & Launch Readiness");
console.log("Migration order: release schema 021 -> trust schema 022");
console.log("Assinatura: Tehkné Solutions");
