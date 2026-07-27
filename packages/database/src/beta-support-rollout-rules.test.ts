import assert from "node:assert/strict";
import test from "node:test";
import {
  approvalDerivedStatus,
  deterministicFeatureDecision,
  evaluateSupportRolloutReadiness,
  supportDeadlines
} from "./beta-support-rollout-rules.js";

test("recalcula os dois prazos quando a prioridade muda", () => {
  const createdAt = "2026-07-27T12:00:00.000Z";
  const low = supportDeadlines("low", createdAt);
  const critical = supportDeadlines("critical", createdAt);
  assert.equal(low.firstResponseDueAt, "2026-07-28T12:00:00.000Z");
  assert.equal(low.resolutionDueAt, "2026-08-03T12:00:00.000Z");
  assert.equal(critical.firstResponseDueAt, "2026-07-27T12:15:00.000Z");
  assert.equal(critical.resolutionDueAt, "2026-07-27T16:00:00.000Z");
});

test("mantém decisão determinística por usuário e flag", () => {
  const input = {
    userId: "32fda19c-8fd5-4705-a2a8-952ce022919c",
    flagKey: "economy.market-v2",
    rolloutPercent: 50,
    variants: ["control", "candidate"],
    defaultVariant: "control"
  } as const;
  assert.deepEqual(
    deterministicFeatureDecision(input),
    deterministicFeatureDecision(input)
  );
});

test("não habilita rollout com percentual zero", () => {
  const result = deterministicFeatureDecision({
    userId: "32fda19c-8fd5-4705-a2a8-952ce022919c",
    flagKey: "economy.market-v2",
    rolloutPercent: 0,
    variants: ["candidate"],
    defaultVariant: "control"
  });
  assert.equal(result.enabled, false);
  assert.equal(result.variant, "control");
});

test("aprovação posterior não desativa flag ativa", () => {
  assert.equal(approvalDerivedStatus({
    currentStatus: "active",
    approvals: 1,
    rejections: 1
  }), "active");
});

test("flag exige duas aprovações independentes para ficar pronta", () => {
  assert.equal(approvalDerivedStatus({
    currentStatus: "draft",
    approvals: 1,
    rejections: 0
  }), "draft");
  assert.equal(approvalDerivedStatus({
    currentStatus: "draft",
    approvals: 2,
    rejections: 0
  }), "ready");
});

test("gate bloqueia SLA vencido, ticket crítico ou ausência de flag", () => {
  const result = evaluateSupportRolloutReadiness({
    supportBreaches: 1,
    openCriticalTickets: 2,
    approvedFlags: 0
  });
  assert.equal(result.ready, false);
  assert.equal(result.blockers.length, 3);
});
