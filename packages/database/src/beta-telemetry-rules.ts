export type BetaRecommendation = "expand" | "hold" | "reduce";

export type BetaHealthInput = Readonly<{
  activatedUsers: number;
  activeUsers: number;
  retentionD1Percent: number;
  retentionD7Percent: number;
  conversionPercent: number;
  errorRatePercent: number;
  averageFeedbackScore: number;
  criticalFeedback: number;
  economyStabilityScore: number;
}>;

export type BetaHealthResult = Readonly<{
  healthScore: number;
  recommendation: BetaRecommendation;
  sampleReady: boolean;
  reasons: readonly string[];
}>;

function clamp(value: number, minimum = 0, maximum = 100): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

export function retentionPercent(
  cohortSize: number,
  returnedUsers: number
): number {
  if (cohortSize <= 0) return 0;
  return clamp(returnedUsers / cohortSize * 100);
}

export function calculateBetaHealth(input: BetaHealthInput): BetaHealthResult {
  const sampleReady = input.activatedUsers >= 25;

  const reliabilityScore = clamp(100 - input.errorRatePercent * 20);
  const retentionScore = clamp(
    input.retentionD1Percent * 0.4 + input.retentionD7Percent * 0.6
  );
  const feedbackScore = clamp((input.averageFeedbackScore / 5) * 100);
  const conversionScore = clamp(input.conversionPercent);
  const economyScore = clamp(input.economyStabilityScore);

  const healthScore = Math.round((
    reliabilityScore * 0.30
    + retentionScore * 0.25
    + feedbackScore * 0.20
    + conversionScore * 0.10
    + economyScore * 0.15
  ) * 100) / 100;

  const reasons: string[] = [];
  if (!sampleReady) reasons.push("Amostra inferior a 25 usuários ativados.");
  if (input.criticalFeedback > 0) {
    reasons.push(`Feedback crítico aberto: ${input.criticalFeedback}.`);
  }
  if (input.errorRatePercent > 2) {
    reasons.push(`Taxa de erro acima de 2%: ${input.errorRatePercent.toFixed(2)}%.`);
  }
  if (input.retentionD7Percent < 25) {
    reasons.push(`Retenção D7 abaixo de 25%: ${input.retentionD7Percent.toFixed(2)}%.`);
  }
  if (input.averageFeedbackScore < 3) {
    reasons.push(
      `Avaliação média abaixo de 3: ${input.averageFeedbackScore.toFixed(2)}.`
    );
  }

  const recommendation: BetaRecommendation =
    input.criticalFeedback > 0
      || input.errorRatePercent > 5
      || healthScore < 55
      ? "reduce"
      : sampleReady
        && healthScore >= 80
        && input.errorRatePercent <= 2
        && input.retentionD7Percent >= 25
        && input.averageFeedbackScore >= 3
        ? "expand"
        : "hold";

  return {
    healthScore,
    recommendation,
    sampleReady,
    reasons
  };
}

export type BetaCommunityReadiness = Readonly<{
  ready: boolean;
  activeAnnouncement: boolean;
  unresolvedCriticalFeedback: number;
  blockers: readonly string[];
}>;

export function evaluateBetaCommunityReadiness(input: {
  activeAnnouncement: boolean;
  unresolvedCriticalFeedback: number;
}): BetaCommunityReadiness {
  const blockers = [
    ...(!input.activeAnnouncement
      ? ["Nenhum anúncio operacional está publicado para o beta."]
      : []),
    ...(input.unresolvedCriticalFeedback > 0
      ? [`Feedback crítico sem resolução: ${input.unresolvedCriticalFeedback}.`]
      : [])
  ];
  return {
    ready: blockers.length === 0,
    ...input,
    blockers
  };
}
