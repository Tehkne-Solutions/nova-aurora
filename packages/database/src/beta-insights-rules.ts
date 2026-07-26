import { createHash } from "node:crypto";

export const ALLOWED_PRODUCT_EVENTS = [
  "session.started",
  "onboarding.step.completed",
  "job.completed",
  "production.completed",
  "market.trade.completed",
  "company.created",
  "feedback.submitted",
  "support.ticket.created",
  "feature.exposed"
] as const;

export type AllowedProductEvent = typeof ALLOWED_PRODUCT_EVENTS[number];

const forbiddenPropertyPattern = /(email|name|message|details|password|token|secret|phone|address|document|cpf|cnpj)/i;

export function sanitizeProductProperties(
  value: unknown
): Readonly<Record<string, string | number | boolean | null>> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("properties deve ser um objeto simples.");
  }

  const result: Record<string, string | number | boolean | null> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 20) {
    throw new Error("properties aceita no máximo 20 campos.");
  }

  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.trim();
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(key)) {
      throw new Error(`Campo de telemetria inválido: ${rawKey}.`);
    }
    if (forbiddenPropertyPattern.test(key)) {
      throw new Error(`Campo sensível não permitido na telemetria: ${key}.`);
    }
    if (rawValue === null || typeof rawValue === "boolean") {
      result[key] = rawValue;
      continue;
    }
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      result[key] = rawValue;
      continue;
    }
    if (typeof rawValue === "string") {
      if (rawValue.length > 160) {
        throw new Error(`Valor de telemetria muito longo: ${key}.`);
      }
      result[key] = rawValue;
      continue;
    }
    throw new Error(`Tipo não permitido na telemetria: ${key}.`);
  }

  return result;
}

export function deterministicFeatureDecision(input: {
  userId: string;
  flagKey: string;
  rolloutPercent: number;
  variants: readonly string[];
  defaultVariant: string;
}): Readonly<{ enabled: boolean; variant: string; bucket: number }> {
  const hash = createHash("sha256")
    .update(`${input.flagKey}:${input.userId}`)
    .digest();
  const bucket = hash.readUInt32BE(0) % 10_000;
  const enabled = bucket < Math.round(input.rolloutPercent * 100);
  if (!enabled || input.variants.length === 0) {
    return { enabled: false, variant: input.defaultVariant, bucket };
  }
  const variantIndex = hash.readUInt32BE(4) % input.variants.length;
  return {
    enabled: true,
    variant: input.variants[variantIndex] ?? input.defaultVariant,
    bucket
  };
}

export type BetaInsightsReadiness = Readonly<{
  ready: boolean;
  telemetryRecent: boolean;
  supportSlaHealthy: boolean;
  featureRolloutPrepared: boolean;
  eventCount24h: number;
  supportBreaches: number;
  openCriticalTickets: number;
  approvedFlags: number;
  blockers: readonly string[];
}>;

export function evaluateBetaInsightsReadiness(input: {
  eventCount24h: number;
  supportBreaches: number;
  openCriticalTickets: number;
  approvedFlags: number;
}): BetaInsightsReadiness {
  const telemetryRecent = input.eventCount24h > 0;
  const supportSlaHealthy = input.supportBreaches === 0
    && input.openCriticalTickets === 0;
  const featureRolloutPrepared = input.approvedFlags > 0;
  const blockers = [
    ...(telemetryRecent ? [] : ["Nenhum evento de produto válido nas últimas 24 horas."]),
    ...(input.supportBreaches > 0
      ? [`Tickets com SLA vencido: ${input.supportBreaches}.`]
      : []),
    ...(input.openCriticalTickets > 0
      ? [`Tickets críticos abertos: ${input.openCriticalTickets}.`]
      : []),
    ...(featureRolloutPrepared
      ? []
      : ["Nenhuma flag pronta ou ativa possui duas aprovações independentes."])
  ];

  return {
    ready: telemetryRecent && supportSlaHealthy && featureRolloutPrepared,
    telemetryRecent,
    supportSlaHealthy,
    featureRolloutPrepared,
    eventCount24h: input.eventCount24h,
    supportBreaches: input.supportBreaches,
    openCriticalTickets: input.openCriticalTickets,
    approvedFlags: input.approvedFlags,
    blockers
  };
}
