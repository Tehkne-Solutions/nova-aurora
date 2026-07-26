import assert from "node:assert/strict";
import test from "node:test";
import {
  deterministicFeatureDecision,
  evaluateBetaInsightsReadiness,
  sanitizeProductProperties
} from "./beta-insights-rules.js";

test("remove telemetria livre e rejeita campos sensíveis", () => {
  assert.deepEqual(sanitizeProductProperties({ step: "welcome", durationMs: 420 }), {
    step: "welcome",
    durationMs: 420
  });
  assert.throws(
    () => sanitizeProductProperties({ email: "user@example.com" }),
    /sensível/
  );
});

test("mantém decisão de rollout estável por usuário", () => {
  const input = {
    userId: "11111111-1111-4111-8111-111111111111",
    flagKey: "new-market",
    rolloutPercent: 50,
    variants: ["control", "treatment"],
    defaultVariant: "control"
  } as const;
  assert.deepEqual(
    deterministicFeatureDecision(input),
    deterministicFeatureDecision(input)
  );
});

test("bloqueia prontidão sem suporte e rollout saudáveis", () => {
  const result = evaluateBetaInsightsReadiness({
    eventCount24h: 10,
    supportBreaches: 1,
    openCriticalTickets: 0,
    approvedFlags: 0
  });
  assert.equal(result.ready, false);
  assert.equal(result.telemetryRecent, true);
  assert.equal(result.supportSlaHealthy, false);
  assert.equal(result.featureRolloutPrepared, false);
});
