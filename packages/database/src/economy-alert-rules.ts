export type EconomyAlertSeverity = "info" | "warning" | "critical";

export type EconomyAlertCode =
  | "high_inflation"
  | "critical_inflation"
  | "deflation"
  | "low_money_velocity"
  | "frozen_money_velocity"
  | "activity_contraction"
  | "activity_shock"
  | "ledger_divergence";

export type EconomyAlert = Readonly<{
  code: EconomyAlertCode;
  severity: EconomyAlertSeverity;
  metric: string;
  observedValue: number;
  thresholdValue: number;
  message: string;
}>;

export type EconomyAlertThresholds = Readonly<{
  highInflationPercent: number;
  criticalInflationPercent: number;
  deflationPercent: number;
  lowMoneyVelocity: number;
  frozenMoneyVelocity: number;
  activityContractionPercent: number;
  activityShockPercent: number;
}>;

export const DEFAULT_ECONOMY_ALERT_THRESHOLDS: EconomyAlertThresholds = Object.freeze({
  highInflationPercent: 8,
  criticalInflationPercent: 15,
  deflationPercent: -5,
  lowMoneyVelocity: 0.25,
  frozenMoneyVelocity: 0.05,
  activityContractionPercent: -20,
  activityShockPercent: -40
});

export type EconomyAlertInput = Readonly<{
  inflationRatePercent: number | null;
  moneyVelocity: number;
  transactionVolumeMinor: number;
  previousTransactionVolumeMinor?: number | null;
  reconciliationDifferenceMinor?: number;
  reconciliationToleranceMinor?: number;
}>;

function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

export function evaluateEconomyAlerts(
  input: EconomyAlertInput,
  thresholds: EconomyAlertThresholds = DEFAULT_ECONOMY_ALERT_THRESHOLDS
): EconomyAlert[] {
  const alerts: EconomyAlert[] = [];
  const inflation = input.inflationRatePercent;

  if (inflation !== null && Number.isFinite(inflation)) {
    if (inflation >= thresholds.criticalInflationPercent) {
      alerts.push({
        code: "critical_inflation",
        severity: "critical",
        metric: "inflationRatePercent",
        observedValue: inflation,
        thresholdValue: thresholds.criticalInflationPercent,
        message: "Inflação crítica detectada."
      });
    } else if (inflation >= thresholds.highInflationPercent) {
      alerts.push({
        code: "high_inflation",
        severity: "warning",
        metric: "inflationRatePercent",
        observedValue: inflation,
        thresholdValue: thresholds.highInflationPercent,
        message: "Inflação elevada detectada."
      });
    } else if (inflation <= thresholds.deflationPercent) {
      alerts.push({
        code: "deflation",
        severity: "warning",
        metric: "inflationRatePercent",
        observedValue: inflation,
        thresholdValue: thresholds.deflationPercent,
        message: "Deflação relevante detectada."
      });
    }
  }

  if (input.moneyVelocity <= thresholds.frozenMoneyVelocity) {
    alerts.push({
      code: "frozen_money_velocity",
      severity: "critical",
      metric: "moneyVelocity",
      observedValue: input.moneyVelocity,
      thresholdValue: thresholds.frozenMoneyVelocity,
      message: "Circulação monetária praticamente paralisada."
    });
  } else if (input.moneyVelocity <= thresholds.lowMoneyVelocity) {
    alerts.push({
      code: "low_money_velocity",
      severity: "warning",
      metric: "moneyVelocity",
      observedValue: input.moneyVelocity,
      thresholdValue: thresholds.lowMoneyVelocity,
      message: "Baixa circulação monetária detectada."
    });
  }

  const previousVolume = input.previousTransactionVolumeMinor;
  if (previousVolume !== null && previousVolume !== undefined) {
    const activityChange = percentChange(input.transactionVolumeMinor, previousVolume);
    if (activityChange !== null) {
      if (activityChange <= thresholds.activityShockPercent) {
        alerts.push({
          code: "activity_shock",
          severity: "critical",
          metric: "transactionVolumeChangePercent",
          observedValue: activityChange,
          thresholdValue: thresholds.activityShockPercent,
          message: "Choque severo de atividade econômica detectado."
        });
      } else if (activityChange <= thresholds.activityContractionPercent) {
        alerts.push({
          code: "activity_contraction",
          severity: "warning",
          metric: "transactionVolumeChangePercent",
          observedValue: activityChange,
          thresholdValue: thresholds.activityContractionPercent,
          message: "Contração relevante de atividade econômica detectada."
        });
      }
    }
  }

  const difference = Math.abs(Math.trunc(input.reconciliationDifferenceMinor ?? 0));
  const tolerance = Math.max(0, Math.trunc(input.reconciliationToleranceMinor ?? 0));
  if (difference > tolerance) {
    alerts.push({
      code: "ledger_divergence",
      severity: "critical",
      metric: "reconciliationDifferenceMinor",
      observedValue: difference,
      thresholdValue: tolerance,
      message: "Divergência entre o snapshot econômico e o razão contábil."
    });
  }

  return alerts;
}
