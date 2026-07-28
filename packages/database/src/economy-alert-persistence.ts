import type { EconomyAlert } from "./economy-alert-rules.js";

export type EconomyAnomalyRecord = Readonly<{
  anomalyKey: string;
  severity: EconomyAlert["severity"];
  metricKey: string;
  observedValue: number;
  expectedMin: number | null;
  expectedMax: number | null;
  evidence: Readonly<{
    code: EconomyAlert["code"];
    message: string;
    thresholdValue: number;
  }>;
}>;

const LOWER_BOUND_ALERTS = new Set<EconomyAlert["code"]>([
  "deflation",
  "low_money_velocity",
  "frozen_money_velocity",
  "activity_contraction",
  "activity_shock"
]);

export function economyAlertToAnomaly(alert: EconomyAlert): EconomyAnomalyRecord {
  const isLowerBound = LOWER_BOUND_ALERTS.has(alert.code);
  return {
    anomalyKey: alert.code,
    severity: alert.severity,
    metricKey: alert.metric,
    observedValue: alert.observedValue,
    expectedMin: isLowerBound ? alert.thresholdValue : null,
    expectedMax: isLowerBound ? null : alert.thresholdValue,
    evidence: {
      code: alert.code,
      message: alert.message,
      thresholdValue: alert.thresholdValue
    }
  };
}
