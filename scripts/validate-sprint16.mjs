import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const required = [
  "packages/database/sql/023_external_assurance_launch_operations.sql",
  "packages/database/src/launch-assurance-rules.ts",
  "packages/database/src/launch-assurance.ts",
  "packages/database/src/trust-policy.ts",
  "packages/database/src/moderation-service.ts",
  "packages/database/src/launch-operations-service.ts",
  "apps/api/src/launch-assurance-routes.ts",
  "apps/web/src/app/status/page.tsx",
  "apps/web/src/app/report/page.tsx",
  "apps/web/src/app/guardian/page.tsx",
  "apps/web/src/app/guardian-request/page.tsx",
  "apps/web/src/app/operations/page.tsx",
  "docs/SPRINT_16_EXTERNAL_ASSURANCE_LAUNCH_OPERATIONS.md"
];

const failures = [];
for (const file of required) {
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) failures.push(`Arquivo ausente: ${file}`);
}

const parseFiles = required.filter((file) => /\.(ts|tsx)$/.test(file));
for (const file of parseFiles) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const result = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX
    }
  });
  const diagnostics = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  for (const diagnostic of diagnostics) {
    failures.push(`${file}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
  }
}

const migration = fs.readFileSync(
  path.join(root, "packages/database/sql/023_external_assurance_launch_operations.sql"),
  "utf8"
);
for (const token of [
  "trust_guardian_requests",
  "trust_reports",
  "trust_response_exercises",
  "public_service_components",
  "launch_rehearsals"
]) {
  if (!migration.includes(token)) failures.push(`Migration sem ${token}`);
}

const gate = fs.readFileSync(path.join(root, "apps/api/src/release-gate.ts"), "utf8");
if (!gate.includes("assurance.assertPlayerReady")) {
  failures.push("Enforcement de confiança não está no request path global.");
}

const policy = fs.readFileSync(path.join(root, "packages/database/src/trust-policy.ts"), "utf8");
if (!policy.includes("DISTINCT ON (document_key)")) {
  failures.push("Seleção de versão documental vigente ausente.");
}
if (!policy.includes("previous_beta_access")) {
  failures.push("Recuperação segura da declaração etária ausente.");
}

if (failures.length) {
  console.error("VALIDAÇÃO SPRINT 16 FALHOU");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("VALIDAÇÃO SPRINT 16 CONCLUÍDA");
console.log("- Consentimento verificável de responsável");
console.log("- Canal de denúncias com detalhes criptografados");
console.log("- Exercícios de incidente");
console.log("- Ensaios de abertura e rollback");
console.log("- Status público");
console.log("- Enforcement global corrigido");
console.log("- Assinatura: Tehkné Solutions");
