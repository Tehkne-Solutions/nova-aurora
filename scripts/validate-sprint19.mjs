import { readFile } from "node:fs/promises";

const required = [
  "packages/database/sql/026_beta_support_feature_rollouts.sql",
  "packages/database/src/beta-support-rollout-rules.ts",
  "packages/database/src/beta-support-rollout-rules.test.ts",
  "packages/database/src/beta-support-rollouts.ts",
  "apps/api/src/beta-support-rollout-routes.ts",
  "docs/SPRINT_19_SUPPORT_FEATURE_ROLLOUTS.md"
];

const contents = await Promise.all(required.map(async (path) => ({
  path,
  content: await readFile(path,"utf8")
})));

const combined = contents.map(({ content }) => content).join("\n");
const signatures = contents.filter(({ content }) => !content.includes("Tehkné Solutions"));
if (signatures.length > 0) {
  throw new Error(`Assinatura ausente em: ${signatures.map(({ path }) => path).join(", ")}`);
}

const migration = contents.find(({ path }) => path.includes("026_"))?.content ?? "";
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
  "feature-rollout-prepared"
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
