import assert from "node:assert/strict";
import test from "node:test";
import { evaluateEconomyAlerts } from "./economy-alert-rules.js";

test("returns no alerts for a stable economy", () => {
  const alerts = evaluateEconomyAlerts({
    inflationRatePercent: 3,
    moneyVelocity: 0.8,
    transactionVolumeMinor: 100_000,
    previousTransactionVolumeMinor: 95_000,
    reconciliationDifferenceMinor: 0,
    reconciliationToleranceMinor: 0
  });
  assert.deepEqual(alerts, []);
});

test("prioritizes critical inflation over high inflation", () => {
  const alerts = evaluateEconomyAlerts({
    inflationRatePercent: 17,
    moneyVelocity: 1,
    transactionVolumeMinor: 100,
    previousTransactionVolumeMinor: 100
  });
  assert.deepEqual(alerts.map((alert) => alert.code), ["critical_inflation"]);
});

test("detects deflation and frozen money velocity", () => {
  const alerts = evaluateEconomyAlerts({
    inflationRatePercent: -6,
    moneyVelocity: 0.03,
    transactionVolumeMinor: 100,
    previousTransactionVolumeMinor: 100
  });
  assert.deepEqual(alerts.map((alert) => alert.code), ["deflation", "frozen_money_velocity"]);
});

test("detects severe activity shock", () => {
  const alerts = evaluateEconomyAlerts({
    inflationRatePercent: null,
    moneyVelocity: 1,
    transactionVolumeMinor: 50_000,
    previousTransactionVolumeMinor: 100_000
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.code, "activity_shock");
  assert.equal(alerts[0]?.observedValue, -50);
});

test("detects ledger divergence above tolerance", () => {
  const alerts = evaluateEconomyAlerts({
    inflationRatePercent: null,
    moneyVelocity: 1,
    transactionVolumeMinor: 100,
    reconciliationDifferenceMinor: -11,
    reconciliationToleranceMinor: 10
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.code, "ledger_divergence");
  assert.equal(alerts[0]?.severity, "critical");
});

test("ignores activity comparison when prior volume is zero", () => {
  const alerts = evaluateEconomyAlerts({
    inflationRatePercent: null,
    moneyVelocity: 1,
    transactionVolumeMinor: 1_000,
    previousTransactionVolumeMinor: 0
  });
  assert.deepEqual(alerts, []);
});
