import { createHash } from "node:crypto";

export type SupportPriority = "low" | "normal" | "high" | "critical";
export type SupportTicketStatus =
  | "open"
  | "acknowledged"
  | "in-progress"
  | "waiting-user"
  | "resolved"
  | "closed";

export type FeatureFlagStatus = "draft" | "ready" | "active" | "paused" | "retired";

export const SUPPORT_SLA_MINUTES: Readonly<
  Record<SupportPriority, Readonly<{ firstResponse: number; resolution: number }>>
> = {
  critical: { firstResponse: 15, resolution: 4 * 60 },
  high: { firstResponse: 60, resolution: 24 * 60 },
  normal: { firstResponse: 8 * 60, resolution: 72 * 60 },
  low: { firstResponse: 24 * 60, resolution: 7 * 24 * 60 }
};

export function supportDeadlines(
  priority: SupportPriority,
  createdAt: Date | string
): Readonly<{ firstResponseDueAt: string; resolutionDueAt: string }> {
  const created = new Date(createdAt);
  if (!Number.isFinite(created.getTime())) {
    throw new Error("Data de criação do ticket inválida.");
  }
  const policy = SUPPORT_SLA_MINUTES[priority];
  return {
    firstResponseDueAt: new Date(
      created.getTime() + policy.firstResponse * 60_000
    ).toISOString(),
    resolutionDueAt: new Date(
      created.getTime() + policy.resolution * 60_000
    ).toISOString()
  };
}

export function deterministicFeatureDecision(input: {
  userId: string;
  flagKey: string;
  rolloutPercent: number;
  variants: readonly string[];
  defaultVariant: string;
}): Readonly<{ enabled: boolean; variant: string; bucket: number }> {
  const percent = Math.min(100, Math.max(0, Math.round(input.rolloutPercent)));
  const hash = createHash("sha256")
    .update(`${input.flagKey}:${input.userId}`)
    .digest();
  const bucket = hash.readUInt32BE(0) % 10_000;
  const enabled = bucket < percent * 100;
  if (!enabled || input.variants.length === 0) {
    return { enabled: false, variant: input.defaultVariant, bucket };
  }
  const variant = input.variants[
    hash.readUInt32BE(4) % input.variants.length
  ] ?? input.defaultVariant;
  return { enabled: true, variant, bucket };
}

export function approvalDerivedStatus(input: {
  currentStatus: FeatureFlagStatus;
  approvals: number;
  rejections: number;
}): FeatureFlagStatus {
  if (["active", "paused", "retired"].includes(input.currentStatus)) {
    return input.currentStatus;
  }
  if (input.rejections > 0) return "draft";
  return input.approvals >= 2 ? "ready" : "draft";
}

export type SupportRolloutReadiness = Readonly<{
  ready: boolean;
  supportHealthy: boolean;
  rolloutPrepared: boolean;
  supportBreaches: number;
  openCriticalTickets: number;
  approvedFlags: number;
  blockers: readonly string[];
}>;

export function evaluateSupportRolloutReadiness(input: {
  supportBreaches: number;
  openCriticalTickets: number;
  approvedFlags: number;
}): SupportRolloutReadiness {
  const supportHealthy = input.supportBreaches === 0
    && input.openCriticalTickets === 0;
  const rolloutPrepared = input.approvedFlags > 0;
  const blockers = [
    ...(input.supportBreaches > 0
      ? [`Tickets com SLA vencido: ${input.supportBreaches}.`]
      : []),
    ...(input.openCriticalTickets > 0
      ? [`Tickets críticos abertos: ${input.openCriticalTickets}.`]
      : []),
    ...(rolloutPrepared
      ? []
      : ["Nenhuma flag pronta ou ativa possui duas aprovações independentes."])
  ];
  return {
    ready: supportHealthy && rolloutPrepared,
    supportHealthy,
    rolloutPrepared,
    ...input,
    blockers
  };
}
