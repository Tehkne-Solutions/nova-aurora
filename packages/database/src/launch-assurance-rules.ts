export const REQUIRED_SERVICE_COMPONENTS = [
  "web",
  "api",
  "market",
  "transactional-email",
  "database"
] as const;

export const REQUIRED_REHEARSAL_TYPES = [
  "public-beta-open",
  "rollback"
] as const;

export type RequiredServiceComponent = typeof REQUIRED_SERVICE_COMPONENTS[number];
export type RequiredRehearsalType = typeof REQUIRED_REHEARSAL_TYPES[number];

export type LaunchOperationsReadiness = Readonly<{
  launchReady: boolean;
  operationalComponents: number;
  requiredComponents: number;
  incidentExerciseCurrent: boolean;
  launchRehearsalCurrent: boolean;
  rollbackRehearsalCurrent: boolean;
  openCriticalReports: number;
  blockers: readonly string[];
}>;

export function evaluateLaunchOperationsReadiness(input: {
  componentStatuses: Readonly<Record<string, string>>;
  latestPassedIncidentExerciseAt: string | null;
  latestPassedRehearsals: Readonly<Record<string, string | null>>;
  openCriticalReports: number;
  now?: Date;
}): LaunchOperationsReadiness {
  const now = input.now ?? new Date();
  const operationalComponents = REQUIRED_SERVICE_COMPONENTS.filter(
    (component) => input.componentStatuses[component] === "operational"
  ).length;

  const withinDays = (value: string | null | undefined, days: number): boolean => {
    if (!value) return false;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp)
      && timestamp <= now.getTime()
      && now.getTime() - timestamp <= days * 86_400_000;
  };

  const incidentExerciseCurrent = withinDays(
    input.latestPassedIncidentExerciseAt,
    180
  );
  const launchRehearsalCurrent = withinDays(
    input.latestPassedRehearsals["public-beta-open"],
    30
  );
  const rollbackRehearsalCurrent = withinDays(
    input.latestPassedRehearsals.rollback,
    30
  );

  const blockers = [
    ...REQUIRED_SERVICE_COMPONENTS
      .filter((component) => input.componentStatuses[component] !== "operational")
      .map((component) => `Componente não operacional: ${component}`),
    ...(!incidentExerciseCurrent
      ? ["Exercício de resposta a incidentes ausente ou vencido."]
      : []),
    ...(!launchRehearsalCurrent
      ? ["Ensaio de abertura do beta ausente ou vencido."]
      : []),
    ...(!rollbackRehearsalCurrent
      ? ["Ensaio de rollback ausente ou vencido."]
      : []),
    ...(input.openCriticalReports > 0
      ? [`Denúncias críticas abertas: ${input.openCriticalReports}`]
      : [])
  ];

  return {
    launchReady: blockers.length === 0,
    operationalComponents,
    requiredComponents: REQUIRED_SERVICE_COMPONENTS.length,
    incidentExerciseCurrent,
    launchRehearsalCurrent,
    rollbackRehearsalCurrent,
    openCriticalReports: input.openCriticalReports,
    blockers
  };
}
