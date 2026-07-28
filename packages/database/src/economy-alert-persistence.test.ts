import assert from "node:assert/strict";
import test from "node:test";
import { economyAlertToAnomaly } from "./economy-alert-persistence.js";

test("maps lower-bound alerts to expected minimum", () => {
  const anomaly = economyAlertToAnomaly({
    code: "frozen_money_velocity",
    severity: "critical",
    metric: "moneyVelocity",
    observedValue: 0.03,
    thresholdValue: 0.05,
    message: "Circulação monetária praticamente paralisada."
  });
  assert.equal(anomaly.expectedMin, 0.05);
  assert.equal(anomaly.expectedMax, null);
});

test("maps upper-bound alerts to expected maximum", () => {
  const anomaly = economyAlertToAnomaly({
    code: "critical_inflation",
    severity: "critical",
    metric: "inflationRatePercent",
    observedValue: 17,
    thresholdValue: 15,
    message: "Inflação crítica detectada."
  });
  assert.equal(anomaly.expectedMin, null);
  assert.equal(anomaly.expectedMax, 15);
});
