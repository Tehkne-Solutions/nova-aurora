import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateExperiment,
  type ExperimentVariantMetrics
} from "./beta-experiment-rules.js";

function variant(
  name: string,
  overrides: Partial<ExperimentVariantMetrics> = {}
): ExperimentVariantMetrics {
  return {
    variant: name,
    exposedUsers: 100,
    activeUsers: 80,
    eligibleD1: 100,
    eligibleD7: 100,
    primaryMetricValue: 50,
    errorRatePercent: 0.5,
    criticalFeedback: 0,
    supportSlaBreaches: 0,
    economyStabilityScore: 95,
    ...overrides
  };
}

const guardrails = {
  maxErrorRatePercent: 2,
  maxCriticalFeedback: 0,
  maxSupportSlaBreaches: 0,
  minimumEconomyStabilityScore: 80
} as const;

test("mantém hold enquanto a retenção D7 não amadureceu", () => {
  const result = evaluateExperiment({
    primaryMetric: "retention-d7",
    runtimeHours: 168,
    minimumRuntimeHours: 168,
    minimumSample: 50,
    minimumLiftPercent: 5,
    control: variant("control",{ eligibleD7: 10,primaryMetricValue: 0 }),
    candidate: variant("candidate",{ eligibleD7: 10,primaryMetricValue: 0 }),
    guardrails
  });
  assert.equal(result.sampleReady,false);
  assert.equal(result.recommendation,"hold");
});

test("recomenda stop diante de feedback crítico", () => {
  const result = evaluateExperiment({
    primaryMetric: "conversion",
    runtimeHours: 200,
    minimumRuntimeHours: 168,
    minimumSample: 50,
    minimumLiftPercent: 5,
    control: variant("control"),
    candidate: variant("candidate",{ criticalFeedback: 1,primaryMetricValue: 60 }),
    guardrails
  });
  assert.equal(result.recommendation,"stop");
});

test("recomenda reduce quando a economia viola o guardrail", () => {
  const result = evaluateExperiment({
    primaryMetric: "conversion",
    runtimeHours: 200,
    minimumRuntimeHours: 168,
    minimumSample: 50,
    minimumLiftPercent: 5,
    control: variant("control"),
    candidate: variant("candidate",{
      primaryMetricValue: 60,
      economyStabilityScore: 70
    }),
    guardrails
  });
  assert.equal(result.recommendation,"reduce");
});

test("recomenda expand somente com amostra madura e lift suficiente", () => {
  const result = evaluateExperiment({
    primaryMetric: "conversion",
    runtimeHours: 200,
    minimumRuntimeHours: 168,
    minimumSample: 50,
    minimumLiftPercent: 5,
    control: variant("control",{ primaryMetricValue: 50 }),
    candidate: variant("candidate",{ primaryMetricValue: 55 }),
    guardrails
  });
  assert.equal(result.sampleReady,true);
  assert.equal(result.liftPercent,10);
  assert.equal(result.recommendation,"expand");
});

test("não expande candidata madura sem ganho mínimo", () => {
  const result = evaluateExperiment({
    primaryMetric: "conversion",
    runtimeHours: 200,
    minimumRuntimeHours: 168,
    minimumSample: 50,
    minimumLiftPercent: 5,
    control: variant("control",{ primaryMetricValue: 50 }),
    candidate: variant("candidate",{ primaryMetricValue: 51 }),
    guardrails
  });
  assert.equal(result.recommendation,"hold");
});
