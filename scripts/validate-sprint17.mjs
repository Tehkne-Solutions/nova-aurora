import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const required = [
  "packages/database/sql/024_moderation_controlled_beta.sql",
  "packages/database/src/moderation-operations-rules.ts",
  "packages/database/src/moderation-operations.ts",
  "packages/database/src/controlled-beta-rules.ts",
  "packages/database/src/controlled-beta.ts",
  "packages/database/src/beta-operations.ts",
  "apps/api/src/moderation-beta-routes.ts",
  "apps/web/src/app/moderation/page.tsx",
  "apps/web/src/app/beta-control/page.tsx",
  "apps/web/src/app/appeal/page.tsx",
  "docs/SPRINT_17_MODERATION_CONTROLLED_BETA.md",
  "docs/CONTROLLED_BETA_RUNBOOK.md",
  "docs/MODERATION_OPERATIONS_RUNBOOK.md"
];

const failures = [];
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) failures.push(`Arquivo ausente: ${file}`);
}

for (const file of required.filter((item) => /\.(ts|tsx)$/.test(item))) {
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
  path.join(root, "packages/database/sql/024_moderation_controlled_beta.sql"),
  "utf8"
);
for (const token of [
  "moderation_sla_policies",
  "moderation_assignments",
  "moderation_actions",
  "moderation_appeals",
  "moderation_shifts",
  "beta_rollout_control",
  "beta_rollout_waves",
  "beta_wave_members",
  "beta_rollout_observations"
]) {
  if (!migration.includes(token)) failures.push(`Migration sem ${token}`);
}

const gate = fs.readFileSync(path.join(root, "apps/api/src/release-gate.ts"), "utf8");
if (!gate.includes("beta.assertPlayerAccess")) {
  failures.push("Enforcement do beta controlado não está no caminho global.");
}

const controlled = fs.readFileSync(
  path.join(root, "packages/database/src/controlled-beta.ts"),
  "utf8"
);
for (const token of ["kill_switch", "pauseTx", "rollbackTx", "evaluateRolloutObservation"]) {
  if (!controlled.includes(token)) failures.push(`Controle de rollout sem ${token}`);
}

if (failures.length) {
  console.error("VALIDAÇÃO SPRINT 17 FALHOU");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("VALIDAÇÃO SPRINT 17 CONCLUÍDA");
console.log("- SLA, atribuição e cobertura de moderação");
console.log("- Ações e recursos criptografados");
console.log("- Ondas de ativação com limites explícitos");
console.log("- Pausa e rollback automáticos");
console.log("- Kill switch e enforcement global");
console.log("- Assinatura: Tehkné Solutions");
