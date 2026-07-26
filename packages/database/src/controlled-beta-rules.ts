export type RolloutDecision = "continue" | "pause" | "rollback";

export type ControlledBetaReadiness = Readonly<{
  ready: boolean;
  mode: string;
  status: string;
  killSwitch: boolean;
  plannedWaves: number;
  activeWaves: number;
  blockers: readonly string[];
}>;

export function evaluateRolloutObservation(input: {
  errorRatePercent: number;
  p95LatencyMs: number;
  criticalReports: number;
  thresholds: {
    maxErrorRatePercent: number;
    maxP95LatencyMs: number;
    maxCriticalReports: number;
  };
}): Readonly<{ decision: RolloutDecision; reasons: readonly string[] }> {
  const reasons: string[] = [];
  if (input.criticalReports > input.thresholds.maxCriticalReports) {
    reasons.push("Denúncias críticas ultrapassaram o limite.");
  }
  if (input.errorRatePercent > input.thresholds.maxErrorRatePercent) {
    reasons.push("Taxa de erro ultrapassou o limite.");
  }
  if (input.p95LatencyMs > input.thresholds.maxP95LatencyMs) {
    reasons.push("Latência p95 ultrapassou o limite.");
  }
  if (input.criticalReports > input.thresholds.maxCriticalReports) {
    return { decision: "rollback", reasons };
  }
  if (reasons.length > 0) return { decision: "pause", reasons };
  return { decision: "continue", reasons };
}

export function evaluateControlledBetaReadiness(input: {
  mode: string;
  status: string;
  killSwitch: boolean;
  plannedWaves: number;
  activeWaves: number;
}): ControlledBetaReadiness {
  const blockers: string[] = [];
  if (input.mode === "closed") blockers.push("O beta controlado está fechado.");
  if (input.killSwitch) blockers.push("O kill switch está ativado.");
  if (input.plannedWaves + input.activeWaves < 1) {
    blockers.push("Não existe onda de ativação planejada.");
  }
  return {
    ready: blockers.length === 0,
    mode: input.mode,
    status: input.status,
    killSwitch: input.killSwitch,
    plannedWaves: input.plannedWaves,
    activeWaves: input.activeWaves,
    blockers
  };
}
