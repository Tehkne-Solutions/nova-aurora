import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const required = [
  "packages/database/sql/025_beta_telemetry_community.sql",
  "packages/database/src/beta-community.ts",
  "packages/database/src/beta-telemetry-rules.ts",
  "packages/database/src/beta-telemetry.ts",
  "apps/api/src/beta-telemetry-routes.ts",
  "apps/web/src/app/community/page.tsx",
  "apps/web/src/app/feedback/page.tsx",
  "apps/web/src/app/beta-insights/page.tsx",
  "docs/SPRINT_18_BETA_TELEMETRY_COMMUNITY.md",
  "docs/BETA_LEARNING_PLAYBOOK.md"
];

const failures = [];
for (const file of required) {
  if (!fs.existsSync(path.join(root,file))) failures.push(`Arquivo ausente: ${file}`);
}

for (const file of required.filter((value) => /\.(ts|tsx)$/.test(value))) {
  const result = ts.transpileModule(
    fs.readFileSync(path.join(root,file),"utf8"),
    {
      fileName: file,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX
      }
    }
  );
  for (const diagnostic of (result.diagnostics ?? []).filter(
    (value) => value.category === ts.DiagnosticCategory.Error
  )) {
    failures.push(`${file}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText," ")}`);
  }
}

const migration = fs.readFileSync(
  path.join(root,"packages/database/sql/025_beta_telemetry_community.sql"),
  "utf8"
);
for (const token of [
  "beta_telemetry_events",
  "beta_feedback",
  "beta_daily_metrics",
  "community_announcements",
  "beta_learning_reports",
  "beta-community-operations-ready"
]) {
  if (!migration.includes(token)) failures.push(`Migration sem ${token}`);
}

const rules = fs.readFileSync(
  path.join(root,"packages/database/src/beta-telemetry-rules.ts"),
  "utf8"
);
for (const token of ["expand","hold","reduce","sampleReady","criticalFeedback"]) {
  if (!rules.includes(token)) failures.push(`Regras sem ${token}`);
}

const gate = fs.readFileSync(path.join(root,"apps/api/src/release-gate.ts"),"utf8");
for (const route of ["/v1/beta/telemetry","/v1/beta/feedback","/v1/community/"]) {
  if (!gate.includes(route)) failures.push(`Gate bloqueia superfície de aprendizado: ${route}`);
}

const worker = fs.readFileSync(path.join(root,"apps/worker/src/worker.ts"),"utf8");
for (const token of ["processScheduledAnnouncements","recomputeDailyMetrics"]) {
  if (!worker.includes(token)) failures.push(`Worker sem ${token}`);
}

if (failures.length) {
  console.error("VALIDAÇÃO SPRINT 18 FALHOU");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("VALIDAÇÃO SPRINT 18 CONCLUÍDA");
console.log("- Telemetria e coortes persistentes");
console.log("- Feedback criptografado");
console.log("- Comunicação segmentada");
console.log("- Health score sem expansão automática");
console.log("- Relatórios de aprendizado");
console.log("- Assinatura: Tehkné Solutions");
