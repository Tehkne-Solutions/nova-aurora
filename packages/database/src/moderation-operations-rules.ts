export type ModerationReadiness = Readonly<{
  ready: boolean;
  activeOrUpcomingModerators: number;
  overdueCriticalReports: number;
  overdueHighReports: number;
  pendingAppeals: number;
  blockers: readonly string[];
}>;

export function evaluateModerationReadiness(input: {
  activeOrUpcomingModerators: number;
  overdueCriticalReports: number;
  overdueHighReports: number;
  pendingAppeals: number;
}): ModerationReadiness {
  const blockers: string[] = [];
  if (input.activeOrUpcomingModerators < 1) {
    blockers.push("Não há cobertura de moderação para as próximas 24 horas.");
  }
  if (input.overdueCriticalReports > 0) {
    blockers.push(`${input.overdueCriticalReports} denúncia(s) crítica(s) fora do SLA.`);
  }
  if (input.overdueHighReports > 0) {
    blockers.push(`${input.overdueHighReports} denúncia(s) alta(s) fora do SLA.`);
  }
  return {
    ready: blockers.length === 0,
    activeOrUpcomingModerators: input.activeOrUpcomingModerators,
    overdueCriticalReports: input.overdueCriticalReports,
    overdueHighReports: input.overdueHighReports,
    pendingAppeals: input.pendingAppeals,
    blockers
  };
}
