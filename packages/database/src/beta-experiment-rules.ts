export type ExperimentRecommendation = "expand" | "hold" | "reduce" | "stop";
export type ExperimentPrimaryMetric =
  | "conversion"
  | "retention-d1"
  | "retention-d7"
  | "feedback"
  | "engagement"
  | "economy";

export type ExperimentVariantMetrics = Readonly<{
  variant: string;
  exposedUsers: number;
  activeUsers: number;
  eligibleD1: number;
  eligibleD7: number;
  primaryMetricValue: number;
  errorRatePercent: number;
  criticalFeedback: number;
  supportSlaBreaches: number;
  economyStabilityScore: number;
}>;

export type ExperimentGuardrails = Readonly<{
  maxErrorRatePercent: number;
  maxCriticalFeedback: number;
  maxSupportSlaBreaches: number;
  minimumEconomyStabilityScore: number;
}>;

export type ExperimentEvaluation = Readonly<{
  sampleReady: boolean;
  recommendation: ExperimentRecommendation;
  liftPercent: number;
  guardrailBreaches: readonly string[];
  reasons: readonly string[];
}>;

function finite(value: number,fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function relativeLift(control: number,candidate: number): number {
  const baseline = finite(control);
  const next = finite(candidate);
  if (baseline === 0) return next > 0 ? 100 : next < 0 ? -100 : 0;
  return Math.round(((next-baseline)/Math.abs(baseline))*10_000)/100;
}

export function evaluateExperiment(input: {
  primaryMetric: ExperimentPrimaryMetric;
  runtimeHours: number;
  minimumRuntimeHours: number;
  minimumSample: number;
  minimumLiftPercent: number;
  control: ExperimentVariantMetrics;
  candidate: ExperimentVariantMetrics;
  guardrails: ExperimentGuardrails;
}): ExperimentEvaluation {
  const retentionEligible = input.primaryMetric === "retention-d1"
    ? input.control.eligibleD1 >= input.minimumSample
      && input.candidate.eligibleD1 >= input.minimumSample
    : input.primaryMetric === "retention-d7"
      ? input.control.eligibleD7 >= input.minimumSample
        && input.candidate.eligibleD7 >= input.minimumSample
      : true;
  const sampleReady = input.runtimeHours >= input.minimumRuntimeHours
    && input.control.exposedUsers >= input.minimumSample
    && input.candidate.exposedUsers >= input.minimumSample
    && retentionEligible;
  const liftPercent = relativeLift(
    input.control.primaryMetricValue,
    input.candidate.primaryMetricValue
  );

  const guardrailBreaches = [
    ...(input.candidate.errorRatePercent > input.guardrails.maxErrorRatePercent
      ? [`Taxa de erro da candidata em ${input.candidate.errorRatePercent.toFixed(2)}%.`]
      : []),
    ...(input.candidate.criticalFeedback > input.guardrails.maxCriticalFeedback
      ? [`Feedback crítico na candidata: ${input.candidate.criticalFeedback}.`]
      : []),
    ...(input.candidate.supportSlaBreaches > input.guardrails.maxSupportSlaBreaches
      ? [`Violações de SLA na candidata: ${input.candidate.supportSlaBreaches}.`]
      : []),
    ...(input.candidate.economyStabilityScore
        < input.guardrails.minimumEconomyStabilityScore
      ? [`Estabilidade econômica da candidata em ${input.candidate.economyStabilityScore.toFixed(2)}.`]
      : [])
  ];

  const severe = input.candidate.criticalFeedback
      > input.guardrails.maxCriticalFeedback
    || input.candidate.supportSlaBreaches
      > input.guardrails.maxSupportSlaBreaches;
  const recommendation: ExperimentRecommendation = severe
    ? "stop"
    : guardrailBreaches.length > 0
      ? "reduce"
      : !sampleReady
        ? "hold"
        : liftPercent >= input.minimumLiftPercent
          ? "expand"
          : liftPercent < 0
            ? "reduce"
            : "hold";

  const reasons = [
    ...(!sampleReady ? [
      `Amostra ou maturidade insuficiente: mínimo de ${input.minimumSample} usuários por variante e ${input.minimumRuntimeHours} horas.`
    ] : []),
    ...(sampleReady ? [`Lift descritivo da candidata: ${liftPercent.toFixed(2)}%.`] : []),
    ...guardrailBreaches
  ];

  return { sampleReady,recommendation,liftPercent,guardrailBreaches,reasons };
}
