import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateBetaHealth,
  evaluateBetaCommunityReadiness,
  retentionPercent
} from "./beta-telemetry-rules.js";

test("calcula retenção de forma segura", () => {
  assert.equal(retentionPercent(100, 34), 34);
  assert.equal(retentionPercent(0, 10), 0);
});

test("recomenda expansão somente com amostra e saúde suficientes", () => {
  const result = calculateBetaHealth({
    activatedUsers: 100,
    activeUsers: 72,
    retentionD1Percent: 65,
    retentionD7Percent: 42,
    conversionPercent: 70,
    errorRatePercent: 0.8,
    averageFeedbackScore: 4.2,
    criticalFeedback: 0,
    economyStabilityScore: 90
  });
  assert.equal(result.recommendation, "expand");
  assert.equal(result.sampleReady, true);
});

test("recomenda redução diante de risco crítico", () => {
  const result = calculateBetaHealth({
    activatedUsers: 100,
    activeUsers: 65,
    retentionD1Percent: 55,
    retentionD7Percent: 30,
    conversionPercent: 60,
    errorRatePercent: 1,
    averageFeedbackScore: 4,
    criticalFeedback: 1,
    economyStabilityScore: 88
  });
  assert.equal(result.recommendation, "reduce");
});

test("bloqueia prontidão comunitária com feedback crítico", () => {
  const result = evaluateBetaCommunityReadiness({
    activeAnnouncement: true,
    unresolvedCriticalFeedback: 2
  });
  assert.equal(result.ready, false);
});
