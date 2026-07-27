import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateBetaHealth,
  evaluateBetaCommunityReadiness,
  retentionPercent
} from "./beta-telemetry-rules.js";

test("calcula retenção de forma segura", () => {
  assert.equal(retentionPercent(100,34),34);
  assert.equal(retentionPercent(0,10),0);
});

test("recomenda expansão somente com amostra e saúde suficientes", () => {
  const result = calculateBetaHealth({
    activatedUsers: 100,
    activeUsers: 86,
    retentionD1Percent: 82,
    retentionD7Percent: 72,
    retentionD1EligibleUsers: 100,
    retentionD7EligibleUsers: 100,
    conversionPercent: 90,
    errorRatePercent: 0.5,
    averageFeedbackScore: 4.8,
    criticalFeedback: 0,
    economyStabilityScore: 95
  });
  assert.ok(result.healthScore >= 80);
  assert.equal(result.recommendation,"expand");
  assert.equal(result.sampleReady,true);
});

test("recomenda redução diante de risco crítico", () => {
  const result = calculateBetaHealth({
    activatedUsers: 100,
    activeUsers: 65,
    retentionD1Percent: 55,
    retentionD7Percent: 30,
    retentionD1EligibleUsers: 100,
    retentionD7EligibleUsers: 100,
    conversionPercent: 60,
    errorRatePercent: 1,
    averageFeedbackScore: 4,
    criticalFeedback: 1,
    economyStabilityScore: 88
  });
  assert.equal(result.recommendation,"reduce");
});

test("mantém a onda quando as coortes de retenção ainda não amadureceram", () => {
  const result = calculateBetaHealth({
    activatedUsers: 25,
    activeUsers: 20,
    retentionD1Percent: 0,
    retentionD7Percent: 0,
    retentionD1EligibleUsers: 0,
    retentionD7EligibleUsers: 0,
    conversionPercent: 80,
    errorRatePercent: 0.2,
    averageFeedbackScore: 4.5,
    criticalFeedback: 0,
    economyStabilityScore: 95
  });
  assert.equal(result.sampleReady,false);
  assert.equal(result.recommendation,"hold");
});

test("bloqueia prontidão comunitária com feedback crítico", () => {
  const result = evaluateBetaCommunityReadiness({
    activeAnnouncement: true,
    unresolvedCriticalFeedback: 2
  });
  assert.equal(result.ready,false);
});
