import { readFile } from "node:fs/promises";

const required = [
  "packages/database/sql/026_beta_support_feature_rollouts.sql",
  "packages/database/src/beta-support-rollout-rules.ts",
  "packages/database/src/beta-support-rollout-rules.test.ts",
  "packages/database/src/beta-support-rollouts.ts",
  "apps/api/src/beta-support-rollout-routes.ts",
  "apps/worker/src/worker.ts",
  "docs/SPRINT_19_SUPPORT_FEATURE_ROLLOUTS.md",
  "package.json"
];

const contents = await Promise.all(required.map(async (path) => ({
  path,
  content: await readFile(path,"utf8")
})));
const byPath = new Map(contents.map((item) => [item.path,item.content]));
const combined = contents.map(({ content }) => content).join("\n");

for (const path of [
  "apps/api/src/beta-support-rollout-routes.ts",
  "apps/worker/src/worker.ts",
  "docs/SPRINT_19_SUPPORT_FEATURE_ROLLOUTS.md"
]) {
  if (!byPath.get(path)?.includes("Tehkné Solutions")) {
    throw new Error(`Assinatura Tehkné Solutions ausente em ${path}.`);
  }
}

const migration = byPath.get(
  "packages/database/sql/026_beta_support_feature_rollouts.sql"
) ?? "";
for (const duplicate of [
  "CREATE TABLE IF NOT EXISTS beta_product_events",
  "CREATE TABLE IF NOT EXISTS beta_feedback_items"
]) {
  if (migration.includes(duplicate)) {
    throw new Error(`A Sprint 19 não pode duplicar estrutura da Sprint 18: ${duplicate}`);
  }
}

for (const expected of [
  "beta_support_tickets",
  "beta_support_updates",
  "beta_feature_flags",
  "beta_feature_flag_approvals",
  "beta_feature_exposures",
  "beta-support-sla-operational",
  "feature-rollout-prepared",
  "validate:sprint19",
  "betaSupportRollouts.syncGates()"
]) {
  if (!combined.includes(expected)) throw new Error(`Entrega ausente: ${expected}`);
}

for (const regression of [
  "O criador não pode aprovar a própria feature flag",
  "ON CONFLICT (flag_id,user_id) DO NOTHING",
  "supportDeadlines(input.priority,String(ticket.created_at))",
  "beta-support-ticket:${input.userId}:${input.idempotencyKey}"
]) {
  if (!combined.includes(regression)) {
    throw new Error(`Regressão sem proteção explícita: ${regression}`);
  }
}

console.log("Sprint 19 validada: suporte, SLA e rollouts sem duplicar a Sprint 18.");
console.log("Tehkné Solutions");
