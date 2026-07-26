export type ModerationReadiness = Readonly<{
  ready: boolean;
  coveredMinutes: number;
  requiredCoverageMinutes: number;
  activeOrUpcomingModerators: number;
  overdueCriticalReports: number;
  overdueHighReports: number;
  pendingAppeals: number;
  blockers: readonly string[];
}>;

export function calculateContinuousCoverageMinutes(
  intervals: readonly Readonly<{ startsAt: string; endsAt: string }>[],
  windowStart: Date,
  windowEnd: Date
): number {
  const start = windowStart.getTime();
  const end = windowEnd.getTime();
  if (end <= start) return 0;

  const normalized = intervals
    .map((interval) => ({
      start: Math.max(start, new Date(interval.startsAt).getTime()),
      end: Math.min(end, new Date(interval.endsAt).getTime())
    }))
    .filter((interval) => Number.isFinite(interval.start)
      && Number.isFinite(interval.end)
      && interval.end > interval.start)
    .sort((left, right) => left.start - right.start);

  let cursor = start;
  let covered = 0;
  for (const interval of normalized) {
    if (interval.start > cursor) break;
    if (interval.end <= cursor) continue;
    covered += interval.end - cursor;
    cursor = interval.end;
    if (cursor >= end) break;
  }
  return Math.floor(covered / 60_000);
}

export function evaluateModerationReadiness(input: {
  coveredMinutes: number;
  requiredCoverageMinutes?: number | undefined;
  activeOrUpcomingModerators: number;
  overdueCriticalReports: number;
  overdueHighReports: number;
  pendingAppeals: number;
}): ModerationReadiness {
  const requiredCoverageMinutes = input.requiredCoverageMinutes ?? 24 * 60;
  const blockers: string[] = [];
  if (input.coveredMinutes < requiredCoverageMinutes) {
    blockers.push(
      `A cobertura contínua de moderação é ${input.coveredMinutes}/${requiredCoverageMinutes} minutos.`
    );
  }
  if (input.activeOrUpcomingModerators < 1) {
    blockers.push("Não há moderador administrativo escalado.");
  }
  if (input.overdueCriticalReports > 0) {
    blockers.push(`${input.overdueCriticalReports} denúncia(s) crítica(s) fora do SLA.`);
  }
  if (input.overdueHighReports > 0) {
    blockers.push(`${input.overdueHighReports} denúncia(s) alta(s) fora do SLA.`);
  }
  return {
    ready: blockers.length === 0,
    coveredMinutes: input.coveredMinutes,
    requiredCoverageMinutes,
    activeOrUpcomingModerators: input.activeOrUpcomingModerators,
    overdueCriticalReports: input.overdueCriticalReports,
    overdueHighReports: input.overdueHighReports,
    pendingAppeals: input.pendingAppeals,
    blockers
  };
}
