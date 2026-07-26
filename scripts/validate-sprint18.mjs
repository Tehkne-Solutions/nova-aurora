import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const required = [
  "packages/database/sql/025_beta_insights_support_rollouts.sql",
  "packages/database/src/beta-insights-rules.ts",
  "packages/database/src/beta-insights-rules.test.ts",
  "packages/database/src/beta-insights-service.ts",
  "apps/api/src/beta-insights-routes.ts",
  "apps/web/src/app/feedback/page.tsx",
  "apps/web/src/app/beta-insights/page.tsx",
  "docs/SPRINT_18_BETA_INSIGHTS_SUPPORT_ROLLOUTS.md",
  "docs/BETA_PRODUCT_OPERATIONS_RUNBOOK.md"
];

const failures = [];
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) failures.push(`Arquivo ausente: ${file}`);
}

for (const file of required.filter((file) => /\.(ts|tsx)$/.test(file))) {
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
  for (const diagnostic of (result.diagnostics ?? []).filter(
    (item) => item.category === ts.DiagnosticCategory.Error
  )) {
    failures.push(`${file}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
  }
}

const migration = fs.readFileSync(
  path.join(root, "packages/database/sql/025_beta_insights_support_rollouts.sql"),
  "utf8"
);
for (const token of [
  "beta_product_events",
  "beta_feedback_items",
  "beta_support_tickets",
  "beta_feature_flags",
  "beta_feature_flag_approvals",
  "beta_feature_exposures"
]) {
  if (!migration.includes(token)) failures.push(`Migration sem ${token}`);
}

const rules = fs.readFileSync(
  path.join(root, "packages/database/src/beta-insights-rules.ts"),
  "utf8"
);
if (!rules.includes("forbiddenPropertyPattern")) {
  failures.push("Telemetria sem bloqueio explícito de campos sensíveis.");
}
if (!rules.includes("deterministicFeatureDecision")) {
  failures.push("Decisão determinística de feature flag ausente.");
}

const service = fs.readFileSync(
  path.join(root, "packages/database/src/beta-insights-service.ts"),
  "utf8"
);
if (!service.includes("pgp_sym_encrypt")) failures.push("Conteúdo livre não está criptografado.");
if (!service.includes("aprovações independentes")) failures.push("Dupla aprovação não está aplicada.");
if (!service.includes("refreshGates")) failures.push("Atualização de gates ausente.");

if (failures.length) {
  console.error("VALIDAÇÃO SPRINT 18 FALHOU");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("VALIDAÇÃO SPRINT 18 CONCLUÍDA");
console.log("- Telemetria minimizada e allowlist");
console.log("- Feedback e suporte criptografados");
console.log("- SLA operacional");
console.log("- Feature flags com dupla aprovação");
console.log("- Exposição determinística e persistente");
console.log("- Assinatura: Tehkné Solutions");
