import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateControlledBetaReadiness,
  evaluateRolloutObservation
} from "./controlled-beta-rules.js";

test("rollout observation continues inside thresholds", () => {
  const result = evaluateRolloutObservation({
    errorRatePercent: 0.8,
    p95LatencyMs: 600,
    criticalReports: 0,
    thresholds: {
      maxErrorRatePercent: 2,
      maxP95LatencyMs: 1200,
      maxCriticalReports: 0
    }
  });
  assert.equal(result.decision, "continue");
});

test("rollout observation pauses on performance degradation", () => {
  const result = evaluateRolloutObservation({
    errorRatePercent: 3,
    p95LatencyMs: 900,
    criticalReports: 0,
    thresholds: {
      maxErrorRatePercent: 2,
      maxP95LatencyMs: 1200,
      maxCriticalReports: 0
    }
  });
  assert.equal(result.decision, "pause");
});

test("rollout observation rolls back on critical reports", () => {
  const result = evaluateRolloutObservation({
    errorRatePercent: 0.5,
    p95LatencyMs: 500,
    criticalReports: 1,
    thresholds: {
      maxErrorRatePercent: 2,
      maxP95LatencyMs: 1200,
      maxCriticalReports: 0
    }
  });
  assert.equal(result.decision, "rollback");
});

test("controlled beta readiness requires a wave", () => {
  const result = evaluateControlledBetaReadiness({
    mode: "controlled",
    status: "paused",
    killSwitch: false,
    plannedWaves: 0,
    activeWaves: 0
  });
  assert.equal(result.ready, false);
});
